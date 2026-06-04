"""
Sequential hypothesis testing using the wealth process approach.

Implements a sequential test for whether the mean of a random variable
exceeds a specified baseline, using adaptive betting (ONS strategy).

Based on:
- Paper: https://arxiv.org/pdf/2502.08166 (Section 4.2)
- Reference implementation: https://github.com/jessica-dai/reporting/blob/main/algorithms.py
"""

import numpy as np
from typing import Optional, List, Dict
from dataclasses import dataclass


@dataclass
class TestState:
    """Snapshot of the current test state."""
    n_observations: int
    wealth: float
    log_wealth: float
    lambda_value: float
    rejected: bool
    rejection_time: Optional[int]
    lower_bound: Optional[float] = None  # Confidence lower bound on mean (after rejection)


class SequentialMeanTest:
    """
    Sequential hypothesis test for H0: mean <= baseline * factor vs H1: mean > baseline * factor.

    Uses a wealth process that accumulates evidence against H0. The test rejects
    when the wealth exceeds 1/alpha (equivalently, log-wealth exceeds log(1/alpha)).

    Parameters
    ----------
    baseline : float
        The null hypothesis value. Tests if true mean > baseline * factor.
    factor : float, default=1.0
        Multiplicative factor applied to baseline. The effective threshold is
        baseline * factor. Use factor > 1 to test for increases above baseline.
    alpha : float, default=0.05
        Significance level (Type I error probability bound).
    lambda_init : float, default=0.5
        Initial value for the adaptive learning rate lambda.

    Attributes
    ----------
    rejected : bool
        Whether the null hypothesis has been rejected.
    n_observations : int
        Number of observations processed so far.

    Examples
    --------
    # Track if daily average feature scores are increasing
    >>> test = SequentialMeanTest(baseline=0.0, alpha=0.05)
    >>> for day_idx, daily_avg in enumerate(daily_averages):
    ...     if test.update(daily_avg):
    ...         print(f"Rejected at day {day_idx}")
    ...         break

    # Track clustering error increase
    >>> error_test = SequentialMeanTest(baseline=0.0, alpha=0.01)
    >>> error_test.update_batch(error_differences)
    >>> print(f"Rejected: {error_test.rejected}, Wealth: {error_test.wealth:.4f}")
    """

    def __init__(
        self,
        baseline: float,
        factor: float = 1.0,
        alpha: float = 0.05,
        lambda_init: float = 0.5,
    ):
        if not 0 < alpha < 1:
            raise ValueError(f"alpha must be in (0, 1), got {alpha}")
        if not 0 <= lambda_init <= 1:
            raise ValueError(f"lambda_init must be in [0, 1], got {lambda_init}")
        if factor <= 0:
            raise ValueError(f"factor must be positive, got {factor}")

        self.baseline = baseline
        self.factor = factor
        self._effective_baseline = baseline * factor
        self.alpha = alpha
        self.lambda_init = lambda_init
        self._threshold = np.log(1 / alpha)

        self.reset()

    def reset(self) -> None:
        """Reset the test to its initial state."""
        self._n_observations = 0
        self._log_wealth = 0.0  # omega, starts at log(1) = 0
        self._lambda = self.lambda_init
        self._rejected = False
        self._rejection_time: Optional[int] = None

        # ONS state: accumulated squared gradients
        self._sum_sq_grads = 1e-8  # small constant for stability

        # Store observations and lambdas for confidence bound computation
        self._observations: List[float] = []
        self._lambdas: List[float] = []  # lambda used at each step

        # Optional history for analysis
        self._history: List[Dict] = []

    @property
    def rejected(self) -> bool:
        """Whether H0 has been rejected."""
        return self._rejected

    @property
    def n_observations(self) -> int:
        """Number of observations processed."""
        return self._n_observations

    @property
    def wealth(self) -> float:
        """Current wealth (capital process value)."""
        return np.exp(self._log_wealth)

    @property
    def log_wealth(self) -> float:
        """Current log-wealth."""
        return self._log_wealth

    @property
    def lambda_value(self) -> float:
        """Current adaptive lambda value."""
        return self._lambda

    @property
    def rejection_time(self) -> Optional[int]:
        """Time step when H0 was rejected (None if not rejected)."""
        return self._rejection_time

    @property
    def effective_baseline(self) -> float:
        """Effective baseline threshold (baseline * factor)."""
        return self._effective_baseline

    def update(self, observation: float, record_history: bool = False) -> bool:
        """
        Process a single observation and update the test state.

        Parameters
        ----------
        observation : float
            The new observation to process.
        record_history : bool, default=False
            If True, record state at each step (useful for analysis/plotting).

        Returns
        -------
        bool
            True if H0 is rejected after this update, False otherwise.
        """
        self._n_observations += 1

        # Store observation and current lambda (before update)
        self._observations.append(observation)
        self._lambdas.append(self._lambda)

        # Do nothing if observation is inf
        if np.isinf(observation):
            print(f"Warning: received infinite observation at step {self._n_observations}, skipping update.")
            if record_history: # never rlly used tho 
                self._history.append({
                    't': self._n_observations,
                    'observation': observation,
                    'g_t': np.nan,
                    'lambda': self._lambda,
                    'log_wealth': self._log_wealth,
                    'rejected': self._rejected,
                })
            return self._rejected

        # Compute deviation from effective baseline (baseline * factor)
        g_t = observation - self._effective_baseline

        # Wealth update: omega += log(1 + lambda * g_t)
        wealth_factor = 1 + self._lambda * g_t

        if wealth_factor <= 0:
            # Wealth would go to zero or negative - set to -inf
            self._log_wealth = -np.inf
        else:
            self._log_wealth += np.log(wealth_factor)

        # Check rejection (only set once, at first rejection)
        if not self._rejected and self._log_wealth > self._threshold:
            self._rejected = True
            self._rejection_time = self._n_observations

        # Update lambda using ONS
        self._update_lambda_ons(g_t)

        # Record history if requested
        if record_history:
            self._history.append({
                't': self._n_observations,
                'observation': observation,
                'g_t': g_t,
                'lambda': self._lambda,
                'log_wealth': self._log_wealth,
                'rejected': self._rejected,
            })

        return self._rejected

    def update_batch(self, observations, record_history: bool = False) -> bool:
        """
        Process a batch of observations sequentially.

        Parameters
        ----------
        observations : array-like
            Batch of observations to process.
        record_history : bool, default=False
            If True, record state at each step.

        Returns
        -------
        bool
            True if H0 is rejected after processing the batch.
        """
        observations = np.asarray(observations).flatten()
        for obs in observations:
            self.update(obs, record_history=record_history)
        return self._rejected

    def run(self, data, record_history: bool = False) -> Optional[int]:
        """
        Run the test on a dataset, processing each element sequentially.

        Processes ALL data (even after rejection) to maintain an updating
        lower confidence bound.

        Parameters
        ----------
        data : array-like
            Dataset to process. Each element is treated as one observation
            (e.g., daily averages).
        record_history : bool, default=False
            If True, record state at each step.

        Returns
        -------
        Optional[int]
            If rejected, returns the index (0-based) of the observation at which
            rejection occurred. If not rejected after processing all data, returns None.
        """
        data = np.asarray(data).flatten()
        rejection_idx = None
        for idx, obs in enumerate(data):
            was_rejected = self._rejected
            self.update(obs, record_history=record_history)
            if not was_rejected and self._rejected:
                rejection_idx = idx
        return rejection_idx

    def _update_lambda_ons(self, g_t: float) -> None:
        """
        Online Normalized Subgradient update for lambda.

        Uses the gradient of the log-wealth function to adaptively
        adjust lambda. Clips to [0, 1].
        """
        # Gradient of log(1 + lambda * g_t) w.r.t. lambda is g_t / (1 + lambda * g_t)
        denom = 1 + self._lambda * g_t
        if denom > 1e-8:
            grad = g_t / denom
        else:
            grad = 0.0

        # Accumulate squared gradients
        self._sum_sq_grads += grad ** 2

        # Adaptive step size
        step_size = 1.0 / np.sqrt(self._sum_sq_grads)

        # Gradient ascent on log-wealth, clip to [0, 1]
        self._lambda = np.clip(self._lambda + step_size * grad, 0.0, 1.0)

    def get_state(self) -> TestState:
        """Return a snapshot of the current test state."""
        return TestState(
            n_observations=self._n_observations,
            wealth=self.wealth,
            log_wealth=self._log_wealth,
            lambda_value=self._lambda,
            rejected=self._rejected,
            rejection_time=self._rejection_time,
            lower_bound=self.lower_confidence_bound() if self._rejected else None,
        )

    def get_history(self) -> List[Dict]:
        """
        Return the recorded history of the test.

        Only populated if update() was called with record_history=True.
        """
        return self._history.copy()

    def p_value_upper_bound(self) -> float:
        """
        Compute an upper bound on the p-value based on current wealth.

        For wealth W, the p-value is bounded by 1/W (Ville's inequality).
        Returns 1.0 if wealth <= 1.
        """
        if self._log_wealth <= 0:
            return 1.0
        return np.exp(-self._log_wealth)

    def _compute_log_wealth_for_mean(self, m: float) -> float:
        """
        Compute the log-wealth that would have accumulated if testing against mean=m.

        Uses the stored observations and lambdas to compute:
        log K_t(m) = sum_i log(1 + lambda_i * (X_i - m))

        Parameters
        ----------
        m : float
            Candidate mean value to test against.

        Returns
        -------
        float
            Log-wealth for testing H0: mean <= m.
        """
        log_wealth = 0.0
        for obs, lam in zip(self._observations, self._lambdas):
            factor = 1 + lam * (obs - m)
            if factor <= 0:
                return -np.inf
            log_wealth += np.log(factor)
        return log_wealth

    def lower_confidence_bound(self, tol: float = 1e-6) -> Optional[float]:
        """
        Compute a (1-alpha) lower confidence bound on the true mean.

        After rejection, this returns the largest m such that we would NOT have
        rejected H0: mean <= m. This is the lower end of an anytime-valid
        confidence interval.

        Uses binary search to find the largest m where log_wealth(m) > threshold.
        The lower bound is then the smallest m where we still reject.

        Based on: Waudby-Smith & Ramdas (2024) "Estimating means of bounded
        random variables by betting", JRSS-B.

        Parameters
        ----------
        tol : float, default=1e-6
            Tolerance for binary search convergence.

        Returns
        -------
        Optional[float]
            Lower confidence bound on the mean, or None if not yet rejected
            or no observations.
        """
        if not self._rejected or len(self._observations) == 0:
            return None

        # Binary search for the boundary where log_wealth(m) = threshold
        # At m=effective_baseline, log_wealth > threshold (we rejected)
        # As m increases toward sample mean, log_wealth decreases
        # We want the largest m where log_wealth(m) > threshold

        obs_array = np.array(self._observations)

        # lo: effective baseline (we know wealth > threshold here)
        lo = self._effective_baseline

        # hi: sample mean (wealth should be ~1 here, definitely < threshold)
        hi = obs_array.mean()

        # If wealth at hi is still > threshold, the bound is above hi
        # Extend hi until we find a point where wealth < threshold
        while self._compute_log_wealth_for_mean(hi) > self._threshold:
            hi = hi + (hi - lo)

        # Binary search for the boundary
        while hi - lo > tol:
            mid = (lo + hi) / 2
            log_w = self._compute_log_wealth_for_mean(mid)

            if log_w > self._threshold:
                # Still rejecting at mid, bound is above mid
                lo = mid
            else:
                # Not rejecting at mid, bound is below mid
                hi = mid

        return lo

    def __repr__(self) -> str:
        status = "REJECTED" if self._rejected else "not rejected"
        factor_str = f", factor={self.factor}" if self.factor != 1.0 else ""
        return (
            f"SequentialMeanTest(baseline={self.baseline}{factor_str}, alpha={self.alpha}, "
            f"status={status}, n={self._n_observations}, wealth={self.wealth:.4f})"
        )
