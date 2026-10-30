import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import App from "./App";
import Quick from "./Quick";
import "./styles.css";
import "./editor.css";

class AppBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal-error">
          <h1>Vamos recuperar sua área de trabalho</h1>
          <p>
            A interface encontrou um problema. Seus documentos salvos permanecem
            no computador.
          </p>
          <pre>{this.state.error}</pre>
          <button onClick={() => location.reload()}>Reabrir interface</button>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <AppBoundary>
    {location.hash === "#quick" ? <Quick /> : <App />}
  </AppBoundary>,
);
