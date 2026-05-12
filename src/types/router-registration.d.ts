import { router } from "../router";

declare module "@tanstack/react-start" {
  interface Register {
    router: typeof router;
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
