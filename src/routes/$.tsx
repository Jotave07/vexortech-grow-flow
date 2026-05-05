import { createFileRoute } from "@tanstack/react-router";
import App from "../App_legacy";

export const Route = createFileRoute("/$")({
  component: App,
});
