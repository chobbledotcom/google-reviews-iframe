#!/usr/bin/env nix-shell
#! nix-shell -i bash -p jq

set -euo pipefail

# Create directory for this & that reviews
mkdir -p reviews/this-and-that

# Process each review using a safer approach
jq -c '.[] | 
  {
    filename: ((.name | gsub(" "; "-") | gsub("[^a-zA-Z0-9-]"; "") | ascii_downcase) + "-" + (.publishedAtDate | split("T")[0]) + ".json"),
    review: {
      author: .name,
      authorUrl: .reviewerUrl,
      rating: .stars,
      content: .text,
      date: .publishedAtDate
    }
  }' tt.json | 
while IFS= read -r line; do
  filename=$(echo "$line" | jq -r '.filename')
  review=$(echo "$line" | jq -c '.review')
  echo "$review" > "reviews/this-and-that/$filename"
done

echo "Transformation complete. Reviews saved to reviews/this-and-that/"