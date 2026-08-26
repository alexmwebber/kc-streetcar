import { config } from "../config.js";
import { fetchStreetcarPositions } from "./gtfsClient.js";
import { insertPosition } from "./vehicleRepository.js";

export function startPoller(): void {
  const poll = async () => {
    try {
      const positions = await fetchStreetcarPositions();
      await Promise.all(positions.map(insertPosition));
      console.log(`[poller] stored ${positions.length} position(s)`);
    } catch (err) {
      console.error("[poller] failed to fetch/store positions:", err);
    }
  };

  poll();
  setInterval(poll, config.pollIntervalMs);
}
