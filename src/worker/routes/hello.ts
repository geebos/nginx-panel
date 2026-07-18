import { Hono } from "hono";

export const helloRoute = new Hono();

helloRoute.get("/hello", (c) => {
  return c.json({ name: "John Doe" });
});
