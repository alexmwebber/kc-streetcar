CREATE TABLE IF NOT EXISTS vehicle_positions (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      TEXT NOT NULL,
    vehicle_label   TEXT,
    trip_id         TEXT,
    route_id        TEXT NOT NULL,
    direction_id    SMALLINT,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    bearing         REAL,
    speed_mps       REAL,
    current_status  TEXT,
    stop_id         TEXT,
    occupancy_percentage SMALLINT,
    feed_timestamp  TIMESTAMPTZ NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_positions_vehicle_time
    ON vehicle_positions (vehicle_id, feed_timestamp);

CREATE INDEX IF NOT EXISTS idx_vehicle_positions_feed_timestamp
    ON vehicle_positions (feed_timestamp);
