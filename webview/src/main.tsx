import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getVsCodeApi } from "./vscode";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("diff-boss webview: #root element is missing");

createRoot(root).render(
  <StrictMode>
    <App api={getVsCodeApi()} />
  </StrictMode>,
);
