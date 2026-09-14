import { config } from "../config.js";
import { fetchStreetcarPositions } from "./gtfsClient.js";
import { fetchStreetcarPredictions } from "./predictionsClient.js";
import { insertPosition } from "./vehicleRepository.js";
import { setPredictions } from "./predictionsStore.js";

export function startPoller(): void {
  const poll = async () => {
    try {
      const positions = await fetchStreetcarPositions();
      await Promise.all(positions.map(insertPosition));
      console.log(`[poller] stored ${positions.length} position(s)`);
    } catch (err) {
      console.error("[poller] failed to fetch/store positions:", err);
    }

    try {
      const predictions = await fetchStreetcarPredictions();
      setPredictions(predictions);
      console.log(`[poller] cached ${predictions.length} stop prediction(s)`);
    } catch (err) {
      console.error("[poller] failed to fetch predictions:", err);
    }
  };

  poll();
  setInterval(poll, config.pollIntervalMs);
}
