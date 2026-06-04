"""Core utilities, LLM API, and annotation functions.
Adapted with permission from https://github.com/rmovva/HypotheSAEs
"""

import os
import time
import json
import numpy as np
from typing import List, Optional, Dict, Tuple
from pathlib import Path
import concurrent.futures
from tqdm.auto import tqdm
import tiktoken
import openai

from .config import PROMPTS_DIR, ANNOTATION_CACHE_DIR, DEFAULT_N_WORKERS

# =============================================================================
# Core Text Utilities
# =============================================================================

_PROMPT_CACHE = {}

def load_prompt(prompt_name: str) -> str:
    """Load a prompt template from the prompts directory (or from cache, if already loaded)."""
    if prompt_name in _PROMPT_CACHE:
        return _PROMPT_CACHE[prompt_name]

    prompt_path = os.path.join(PROMPTS_DIR, f"{prompt_name}.txt")
    try:
        with open(prompt_path) as f:
            content = f.read()
            _PROMPT_CACHE[prompt_name] = content
            return content
    except FileNotFoundError:
        raise FileNotFoundError(f"File not found: {prompt_path}; please ensure prompts are in the prompts/ directory")

def truncate_text(
    text: str,
    max_words: Optional[int] = None,
    max_chars: Optional[int] = None,
    max_tokens: Optional[int] = None,
    truncation_message: str = "[... rest of text is truncated]"
) -> str:
    """
    Truncate text based on words, characters, or tokens.

    Args:
        text: Input text to truncate
        max_words: Maximum number of words
        max_chars: Maximum number of characters
        max_tokens: Maximum number of tokens (using tiktoken)

    Returns:
        Truncated text with indicator if truncated
    """
    if all(x is None for x in [max_words, max_chars, max_tokens]):
        return text

    if text.endswith(truncation_message):
        return text
    truncated = text

    if max_words is not None:
        words = text.split()
        if len(words) > max_words:
            truncated = ' '.join(words[:max_words])

    if max_chars is not None:
        if len(truncated) > max_chars:
            truncated = truncated[:max_chars]

    if max_tokens is not None:
        enc = tiktoken.get_encoding("cl100k_base")
        tokens = enc.encode(truncated)
        if len(tokens) > max_tokens:
            truncated = enc.decode(tokens[:max_tokens])

    if truncated != text:
        truncated += truncation_message

    return truncated

def filter_invalid_texts(texts: List[str]) -> List[str]:
    """Filter out None values and empty strings from a list of texts.

    Args:
        texts: List of text strings, potentially containing None or empty strings

    Returns:
        Filtered list with None values and empty strings removed
    """
    original_count = len(texts)
    filtered_texts = [text for text in texts if text is not None and len(str(text).strip()) > 0]
    filtered_count = original_count - len(filtered_texts)

    if filtered_count > 0:
        print(f"Warning: ignoring {filtered_count} items which are None or empty strings")

    return filtered_texts


# =============================================================================
# LLM API Utilities
# =============================================================================

_CLIENT_OPENAI = None  # Module-level cache for the OpenAI client

"""
These model IDs point to the latest versions of the models as of 2025-05-04.
We point to a specific version for reproducibility, but feel free to update them as necessary.
Note that o-series models (o1, o1-mini, o3-mini) are also supported by get_completion().
We don't point these models to a specific version, so passing in these model names will use the latest version.

2025-05-04:
- Removed gpt-4 (deprecated by gpt-4o, will be removed from API soon)
- Added gpt-4.1 models (not used by HypotheSAEs paper, but potentially of interest)

2025-03-12:
- First version of this file: supports gpt-4o, gpt-4o-mini, gpt-4
"""
model_abbrev_to_id = {
    'gpt4o': 'gpt-4o-2024-11-20',
    'gpt-4o': 'gpt-4o-2024-11-20',
    'gpt4o-mini': 'gpt-4o-mini-2024-07-18',
    'gpt-4o-mini': 'gpt-4o-mini-2024-07-18',

    "gpt4.1": "gpt-4.1-2025-04-14",
    "gpt-4.1": "gpt-4.1-2025-04-14",
    "gpt4.1-mini": "gpt-4.1-mini-2025-04-14",
    "gpt-4.1-mini": "gpt-4.1-mini-2025-04-14",
    "gpt4.1-nano": "gpt-4.1-nano-2025-04-14",
    "gpt-4.1-nano": "gpt-4.1-nano-2025-04-14",
    "gpt5": "gpt-5",
    "gpt-5": "gpt-5",
}

DEFAULT_MODEL = "gpt-4.1-mini"


def _model_suffix(model):
    """Return filename suffix for non-default models, empty string for default."""
    if model is None or model == DEFAULT_MODEL:
        return ''
    return f'_{model}'

def get_client():
    """Get the OpenAI client, initializing it if necessary and caching it."""
    global _CLIENT_OPENAI
    if _CLIENT_OPENAI is not None:
        return _CLIENT_OPENAI

    api_key = os.environ.get('OPENAI_KEY')
    if api_key is None or '...' in api_key:
        raise ValueError("Please set the OPENAI_KEY environment variable before using functions which require the OpenAI API.")

    _CLIENT_OPENAI = openai.OpenAI(api_key=api_key)
    return _CLIENT_OPENAI

def get_completion(
    prompt: str,
    model: str = DEFAULT_MODEL,
    timeout: float = 15.0,
    max_retries: int = 3,
    backoff_factor: float = 2.0,
    **kwargs
) -> str:
    """
    Get completion from OpenAI API with retry logic and timeout.

    Args:
        prompt: The prompt to send
        model: Model to use
        max_retries: Maximum number of retries on rate limit
        backoff_factor: Factor to multiply backoff time by after each retry
        timeout: Timeout for the request
        **kwargs: Additional arguments to pass to the OpenAI API; max_tokens, temperature, etc.
    Returns:
        Generated completion text

    Raises:
        Exception: If all retries fail
    """
    client = get_client()
    model_id = model_abbrev_to_id.get(model, model)

    # Use longer timeout for slower models
    if model.startswith('o') or 'gpt-5' in model:
        timeout = max(timeout, 90.0)

    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=model_id,
                messages=[{"role": "user", "content": prompt}],
                timeout=timeout,
                **kwargs
            )
            content = response.choices[0].message.content
            if content is None or content.strip() == '':
                finish_reason = response.choices[0].finish_reason
                print(f"API returned empty content (finish_reason={finish_reason}, model={model_id})")
            return content

        except (openai.RateLimitError, openai.APITimeoutError) as e:
            if attempt == max_retries - 1:  # Last attempt
                raise e

            wait_time = timeout * (backoff_factor ** attempt)
            if attempt > 0:
                print(f"API error: {e}; retrying in {wait_time:.1f}s... ({attempt + 1}/{max_retries})")
            time.sleep(wait_time)


# =============================================================================
# Annotation Utilities
# =============================================================================

ANNOTATION_CACHE_DIR_LOCAL = ANNOTATION_CACHE_DIR

def get_annotation_cache(cache_path: str) -> dict:
    """Load cached annotations from JSON file."""
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'r') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"Warning: Failed to parse cache file {cache_path}, starting fresh cache")
            os.remove(cache_path)
    return {}

def save_annotation_cache(cache_path: str, cache: dict) -> None:
    """Save annotations to JSON cache file."""
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, 'w') as f:
        json.dump(cache, f)

def generate_cache_key(concept: str, text: str) -> str:
    """Generate a cache key for a given concept and text."""
    return f"{concept}|||{text[:100]}[...]{text[-100:]}"

def _store_annotation(
    results: Dict[str, Dict[str, int]],
    concept: str,
    text: str,
    annotation: int,
    cache: Optional[dict] = None,
) -> None:
    """Insert an annotation into results and (optionally) cache."""
    if concept not in results:
        results[concept] = {}
    results[concept][text] = annotation
    if cache is not None:
        cache[generate_cache_key(concept, text)] = annotation

def parse_completion(completion: str) -> int:
    """Parse a completion into an annotation."""
    if '</think>' in completion:
        completion = completion.split('</think>')[1].strip()
    return 1 if completion.startswith("yes") else 0 if completion.startswith("no") else None

def annotate_single_text(
    text: str,
    concept: str,
    annotate_prompt_name: str = "annotate",
    model: str = "gpt-4o-mini",
    max_words_per_example: Optional[int] = None,
    temperature: float = 0.0,
    max_tokens: int = 1,
    max_retries: int = 3,
    timeout: float = 5.0,
) -> Tuple[Optional[int], float]:  # Return tuple of (result, api_time)
    """
    Annotate a single text with given concept using LLM.
    Returns (annotation, api_time) where annotation is 1 (present), 0 (absent), or None (failed).
    """
    if max_words_per_example:
        text = truncate_text(text, max_words_per_example)

    annotate_prompt = load_prompt(annotate_prompt_name)
    prompt = annotate_prompt.format(hypothesis=concept, text=text)

    total_api_time = 0.0
    for attempt in range(max_retries):
        try:
            start_time = time.time()
            if model.startswith('o') or 'gpt-5' in model:
                temperature = 1.0
                max_tokens = 512
                timeout = max(timeout, 30.0)
            raw = get_completion(
                prompt=prompt,
                model=model,
                temperature=temperature,
                max_completion_tokens=max_tokens,
                timeout=timeout
            )
            total_api_time += time.time() - start_time

            if raw is None or raw.strip() == '':
                print(f"API returned empty/None for concept '{concept}' (likely content filter), attempt {attempt + 1}/{max_retries}")
                continue

            response_text = raw.strip().lower()
            annotation = parse_completion(response_text)
            if annotation is not None:
                return annotation, total_api_time
            else:
                print(f"parse_completion returned None for concept '{concept}', response: {repr(response_text[:200])}")

        except Exception as e:
            if attempt == max_retries - 1:
                print(f"Failed to annotate after {max_retries} attempts: {e}")
                return None, total_api_time
            continue

    return None, total_api_time

def _parallel_annotate(
    tasks: List[Tuple[str, str]],
    model: str,
    n_workers: int,
    results: Dict[str, Dict[str, int]],
    cache: Optional[dict] = None,
    progress_desc: str = "Annotating",
    show_progress: bool = True,
    **annotation_kwargs
) -> None:
    # Keep track of tasks that need to be retried
    retry_tasks = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=n_workers) as executor:
        future_to_task = {
            executor.submit(annotate_single_text, text=text, concept=concept, model=model, **annotation_kwargs):
            (text, concept)
            for text, concept in tasks
        }

        iterator = tqdm(concurrent.futures.as_completed(future_to_task),
                       total=len(tasks),
                       desc=progress_desc,
                       disable=not show_progress)

        for future in iterator:
            text, concept = future_to_task[future]
            try:
                annotation, _ = future.result()
                if annotation is not None:
                    _store_annotation(results, concept, text, annotation, cache)
                else:
                    retry_tasks.append((text, concept))
                    print(f"Annotation returned None for concept '{concept}', scheduling retry")
            except Exception as e:
                retry_tasks.append((text, concept))
                print(f"Failed to annotate text for concept '{concept}': {e}")

    # Retry failed tasks sequentially
    if retry_tasks:
        print(f"Retrying {len(retry_tasks)} failed tasks...")
        for text, concept in retry_tasks:
            try:
                annotation, _ = annotate_single_text(text=text, concept=concept, model=model, **annotation_kwargs)
                if annotation is not None:
                    _store_annotation(results, concept, text, annotation, cache)
            except Exception as e:
                print(f"Failed to annotate text for concept '{concept}' during retry: {e}")

def annotate(
    tasks: List[Tuple[str, str]],
    model: str = "gpt-4.1-mini",
    cache_path: Optional[str] = None,
    n_workers: int = DEFAULT_N_WORKERS,
    show_progress: bool = True,
    progress_desc: str = "Annotating",
    use_cache_only: bool = False,
    uncached_value: int = 0,
    annotate_prompt_name: str = "annotate",
    **annotation_kwargs
) -> Dict[Tuple[str, str], int]:
    """
    Annotate a list of (text, concept) tasks.

    Args:
        tasks: List of (text, concept) tuples to annotate
        model: Model to use for annotation
        cache_path: Path to cache file
        n_workers: Number of workers for parallel processing
        show_progress: Whether to show progress bar
        use_cache_only: Whether to only use the cache and set uncached items to uncached_value
        uncached_value: Value to set for uncached items
        annotate_prompt_name: Name of the annotation prompt to use ('annotate' or 'annotate_perspective')
        **annotation_kwargs: Additional arguments passed to annotate_single_text

    Returns:
        Dictionary mapping (text, concept) to annotation result
    """
    # Load existing cache
    cache = get_annotation_cache(cache_path) if cache_path else {}
    results = {}
    uncached_tasks = []

    # Check cache and prepare uncached tasks
    for text, concept in tasks:
        if concept not in results:
            results[concept] = {}
        cache_key = generate_cache_key(concept, text)
        if cache_key in cache:
            results[concept][text] = cache[cache_key]
        elif use_cache_only:
            results[concept][text] = uncached_value
            uncached_tasks.append((text, concept))
        else:
            uncached_tasks.append((text, concept))

    if use_cache_only:
        print(f"Found {len(tasks) - len(uncached_tasks)} cached items; mapped {len(uncached_tasks)} uncached items to {uncached_value}")
        return results

    # Print cache statistics
    if show_progress:
        print(f"Found {len(tasks) - len(uncached_tasks)} cached items; annotating {len(uncached_tasks)} uncached items")

    # Annotate uncached tasks
    if uncached_tasks:
            _parallel_annotate(
                tasks=uncached_tasks,
                model=model,
                n_workers=n_workers,
                cache=cache,
                results=results,
                show_progress=show_progress,
                progress_desc=progress_desc,
                annotate_prompt_name=annotate_prompt_name,
                **annotation_kwargs
            )

    # Save cache if path provided
    if cache_path:
        save_annotation_cache(cache_path, cache)

    return results
