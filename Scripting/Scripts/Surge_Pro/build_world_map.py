import json
import math

with open("world.geojson", encoding="utf-8") as source:
    data = json.load(source)


def simplify(points, epsilon=1.2):
    if len(points) < 3:
        return points
    result = [points[0]]
    for point in points[1:-1]:
        if math.hypot(point[0] - result[-1][0], point[1] - result[-1][1]) >= epsilon:
            result.append(point)
    result.append(points[-1])
    return result


def path_for_ring(points):
    points = simplify(points)
    return "M" + "L".join(
        f"{(longitude + 180) * 2.78:.1f},{(90 - latitude) * 2.78:.1f}"
        for longitude, latitude in points
    ) + "Z"

paths = []
for feature in data["features"]:
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    polygons = [coordinates] if geometry.get("type") == "Polygon" else coordinates
    for polygon in polygons:
        if polygon:
            paths.append(path_for_ring(polygon[0]))

svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet"><g fill="#d9d7ed" stroke="#bdb9dc" stroke-width="0.8">' + "".join(f'<path d="{path}"/>' for path in paths) + "</g></svg>"
with open("world-map.svg", "w", encoding="utf-8") as target:
    target.write(svg)
