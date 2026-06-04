export type InitResponse = {
  type: "init";
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: "increment";
  postId: string;
  count: number;
};

export type IncrementRequest = {
  amount: number;
};

export type DecrementResponse = {
  type: "decrement";
  postId: string;
  count: number;
};

export type DecrementRequest = {
  amount: number;
};

export const ApiEndpoint = {
  Init: "/api/init",
  Increment: "/api/increment",
  Decrement: "/api/decrement",
  OnPostCreate: "/internal/menu/post-create",
  OnAppInstall: "/internal/on-app-install",
  Scrape: "/internal/scrape",
  OnMenuScrapeNow: "/internal/menu/scrape-now",
  OnMenuClearSeen: "/internal/menu/clear-seen",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];
