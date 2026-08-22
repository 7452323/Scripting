import re
import urllib.request

# Download the JS bundle
url = "https://assets.lrts.me/fed-lrts-wap/5d76ce0.js"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
data = urllib.request.urlopen(req, timeout=10).read().decode("utf-8", errors="replace")

# Find all LRTS domain URLs
urls = sorted(set(re.findall(r'https?://[^\s"\']+lrts\.me[^\s"\']*', data)))
print("=== LRTS domain URLs ===")
for u in urls[:30]:
    print(u)

# Find API paths
paths = sorted(set(re.findall(r'"/[a-z]+/[a-zA-Z]+"', data)))
print("\n=== API paths ===")
for p in paths[:30]:
    print(p)

# Search for audio-related strings in the data attributes or URLs
audio_refs = sorted(set(re.findall(r'(?:audio|play|track|stream|media|source)[A-Za-z]*', data)))
print("\n=== Audio-related identifiers ===")
for a in audio_refs[:30]:
    print(a)
