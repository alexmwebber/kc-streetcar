import os

from dotenv import load_dotenv
from google.transit import gtfs_realtime_pb2
import requests

load_dotenv()

url = "https://api.goswift.ly/real-time/kcata/gtfs-rt-vehicle-positions"
headers = {"Authorization": os.environ["SWIFTLY_API_KEY"]}

resp = requests.get(url, headers=headers)
feed = gtfs_realtime_pb2.FeedMessage()
feed.ParseFromString(resp.content)

STREETCAR_ROUTE_ID = "601"  # replace with whatever routes.txt actually says

for entity in feed.entity:
    if entity.HasField("vehicle") and entity.vehicle.trip.route_id == STREETCAR_ROUTE_ID:
        v = entity.vehicle
        print(entity.vehicle)