import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você está procurando não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Hype Delivery" },
      { name: "theme-color", content: "#000000" },
      { name: "description", content: "Hype Delivery conecta lojas parceiras, cardápios, checkout, pagamentos, pedidos e acompanhamento em tempo real." },
      { name: "author", content: "Hype Delivery" },
      { property: "og:title", content: "Hype Delivery" },
      { property: "og:description", content: "Hype Delivery conecta lojas parceiras, cardápios, checkout, pagamentos, pedidos e acompanhamento em tempo real." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://hypedelivery.com.br" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Hype Delivery" },
      { name: "twitter:description", content: "Hype Delivery conecta lojas parceiras, cardápios, checkout, pagamentos, pedidos e acompanhamento em tempo real." },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
