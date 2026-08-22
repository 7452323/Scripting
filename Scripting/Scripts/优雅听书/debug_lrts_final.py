import urllib.request
import json
import ssl

ctx = ssl.create_default_context()

def get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        "Referer": "https://m.lrts.me/",
        "Accept": "application/json, text/plain, */*",
    })
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            return resp.read().decode()
    except Exception as e:
        return f"ERROR: {e}"

# Maybe the getBookMenu has a different format with data field
print("=== Try getBookMenu with tmeId ===")
result = get("https://m.lrts.me/ajax/getBookMenu?tmeId=1155240557&page=1&pagesize=1")
print(f"Result: {result[:500]}")

# Maybe the API is now at a different path
print("\n=== Try different API paths ===")
paths = [
    "/ajax/getTrack",
    "/ajax/track",
    "/ajax/getAudio",
    "/ajax/audio",
    "/ajax/getPlay",
    "/ajax/play",
    "/ajax/getMedia",
    "/ajax/media",
    "/ajax/getResource",
    "/ajax/resource",
]
for p in paths:
    result = get(f"https://m.lrts.me{p}?id=1155240557")
    if "ERROR" not in result and not result.startswith("<!"):
        print(f"  {p}: {result[:200]}")
    else:
        print(f"  {p}: {result[:80]}")

# Maybe the API needs a different base URL
print("\n=== Try different base URLs ===")
bases = [
    "https://m.lrts.me",
    "https://www.lrts.me",
    "https://lrts.me",
]
for base in bases:
    result = get(f"{base}/ajax/trackUrl?id=1155240557&entityId=39823095&entityType=1")
    if "ERROR" not in result and not result.startswith("<!"):
        print(f"  {base}: {result[:200]}")
    else:
        print(f"  {base}: {result[:80]}")
