import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/", label: "Live Map" },
  { to: "/analysis", label: "Data Analysis" },
  { to: "/about", label: "About" },
];

export default function NavBar() {
  return (
    <nav className="nav-bar">
      <span className="nav-brand">KC Streetcar</span>
      {TABS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          // `end` so "/" only matches exactly, rather than staying active on /analysis.
          end={to === "/"}
          className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
