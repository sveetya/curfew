import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { CurfewCard } from "./components/CurfewCard";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CurfewCard />
  </StrictMode>,
);
