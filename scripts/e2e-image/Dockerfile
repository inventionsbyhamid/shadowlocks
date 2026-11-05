# Browser image for end-to-end tests and frame-by-frame video on the build server.
# Playwright's Chromium (matches @playwright/test 1.64.1) plus ffmpeg for encoding frames.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
