import { Link } from "react-router-dom";

export default function About() {
  return (
    <div className="about-page">
      <article className="about-content">
        <h1 className="about-title">About</h1>

        <section className="about-section">
          <h2 className="about-heading">What is this site?</h2>
          <p>
            This is a hobby project made by me (with the help of Claude) that tracks the positions of Kansas City
            streetcars. I wanted to create an app that helps you easily see where the streetcar is so you can plan your
            route, without any additional fluff.
          </p>
          <p className="about-note">
            For actual transit route planning in Kansas City, use the{" "}
            <a href="https://transitapp.com/" target="_blank" rel="noreferrer">
              Transit app
            </a>{" "}
            or your preferred map platform, which all use the same data feed that this website uses.
          </p>
        </section>

        <section className="about-section">
          <h2 className="about-heading">How does it work?</h2>
          <p>
            This site calls a backend server which polls the{" "}
            <a href="https://www.goswift.ly/" target="_blank" rel="noreferrer">
              Swiftly
            </a>{" "}
            real-time transit GTFS API every 15 seconds to get the live positions of the vehicles (and estimated stop
            arrival times). That data is then stored in a database every 30 minutes for future data analysis use.
          </p>
        </section>

        <section className="about-section">
          <h2 className="about-heading">
            <Link to="/analysis">Data Analysis</Link>
          </h2>
          <p>
            Shows the average speed (or occupancy) of streetcars along the route. The speed and occupancy data comes from
            the stored data returned by the Swiftly feed, dating back to 9/11/2026. Two kinds of data points are removed:
          </p>
          <ul className="about-list">
            <li>
              <strong>Speed of 0 for over 2 minutes</strong> — almost entirely when the streetcar is stopped at the end
              of the line.
            </li>
            <li>
              <strong>Speed greater than 45 mph</strong> — GPS outliers.
            </li>
          </ul>
        </section>

        <section className="about-section">
          <h2 className="about-heading">Contact</h2>
          <p className="about-contact">
            Alex Webber
            <br />
            <a href="mailto:contact@streetcartracker.com">contact@streetcartracker.com</a>
          </p>
        </section>
      </article>
    </div>
  );
}
