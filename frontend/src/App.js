import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AnalyzePage from "@/pages/AnalyzePage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AnalyzePage />} />
      </Routes>
      <Toaster position="top-right" richColors />
    </BrowserRouter>
  );
}

export default App;
