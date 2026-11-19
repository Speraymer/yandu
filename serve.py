"""Serve the reader locally with browser-compatible module MIME types."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial


class ReaderFiles(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
    }


if __name__ == "__main__":
    handler = partial(ReaderFiles, directory=Path(__file__).resolve().parent)
    with ThreadingHTTPServer(("127.0.0.1", 8000), handler) as server:
        print("http://127.0.0.1:8000/", flush=True)
        server.serve_forever()
