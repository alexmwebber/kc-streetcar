import { Navigate, Route, Routes } from "react-router-dom";
import NavBar from "./components/NavBar.js";
import ThemeToggle from "./components/ThemeToggle.js";
import { useTheme } from "./lib/useTheme.js";
import About from "./pages/About.js";
import LiveMap from "./pages/LiveMap.js";
import SpeedAnalysis from "./pages/SpeedAnalysis.js";

export default function App() {
  // Theme lives here and only here. useTheme is a plain hook with no provider, so
  // calling it from two pages would give two independent copies of the state that
  // fight over <html data-theme>. Both pages take it as a prop instead.
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="app-shell" data-theme={theme} style={{ colorScheme: theme }}>
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<LiveMap theme={theme} />} />
          <Route path="/analysis" element={<SpeedAnalysis theme={theme} />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </div>
  );
}
