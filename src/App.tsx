import { BrowserRouter, Routes, Route } from "react-router-dom";
import FormPage from "./pages/FormPage";
import DonePage from "./pages/DonePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<FormPage />} />
        <Route path="/done" element={<DonePage />} />
      </Routes>
    </BrowserRouter>
  );
}