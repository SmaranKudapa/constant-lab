"""Serves the viewer (web/) and the live event feed from the lab's Modal Volume.
Deploy:  modal deploy server/viewer_app.py     (prints the public URL)
NOT YET RUN ON MODAL: written against Modal's documented API; check names against current docs on first deploy.
Assumes the lab writes /data/events.jsonl on the Volume named "constant-lab" (see constant_lab/events.py).
If several containers write at once, use one writer or a modal.Queue/Dict instead of appending to a shared file."""
import modal

app = modal.App("constant-lab-viewer")
volume = modal.Volume.from_name("constant-lab", create_if_missing=True)
image = (modal.Image.debian_slim().pip_install("fastapi[standard]")
         .add_local_dir("web", "/web").add_local_python_source("constant_lab"))

@app.function(image=image, volumes={"/data": volume})
@modal.asgi_app()
def web():
    from fastapi import FastAPI
    from fastapi.staticfiles import StaticFiles
    from constant_lab.events import read_since

    api = FastAPI()

    @api.get("/api/events")
    def events(since: int = 0):
        volume.reload()  # pick up lines other containers have committed
        return {"events": read_since(since, "/data/events.jsonl")}

    api.mount("/", StaticFiles(directory="/web", html=True), name="web")
    return api
