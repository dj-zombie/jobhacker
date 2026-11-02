import * as React from "react";
import { navigate } from "../demo/router";

/*
  Prototype-only stand-in for next/link. The kit imports `next/link` exactly as
  a Next.js app would; in this Vite build that import resolves here and routes
  through the demo's in-memory router instead of the URL.
*/
type LinkProps = Omit<React.ComponentProps<"a">, "href"> & { href: string; prefetch?: boolean };

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, onClick, prefetch: _prefetch, ...props },
  ref,
) {
  return (
    <a
      ref={ref}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(href);
      }}
      {...props}
    />
  );
});

export default Link;
