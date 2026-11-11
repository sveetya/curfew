import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { CurfewCard } from "./components/CurfewCard";

const mount = document.getElementById("root");
if (!mount) throw new Error("index.html has no #root element");

createRoot(mount).render(
  <StrictMode>
    <CurfewCard />
  </StrictMode>,
);
