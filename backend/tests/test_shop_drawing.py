import os

os.environ.setdefault("ALLOW_MEMORY_FALLBACK", "true")
os.environ.pop("MONGODB_URI", None)

import asyncio

import pytest
from fastapi import HTTPException

from app import main as app_main


def _reset():
    app_main.projects_col.docs.clear()
    app_main.shop_drawings_col.docs.clear()


class FakeUploadFile:
    def __init__(self, filename, content):
        self.filename = filename
        self._content = content

    async def read(self):
        return self._content


def test_upload_shop_drawing_stores_file_and_updates_project():
    _reset()
    project = app_main.create_project()
    result = asyncio.run(app_main.upload_shop_drawing(
        project["id"], FakeUploadFile("Kitchen-Plan-Rev2.pdf", b"%PDF-1.4 fake content"),
    ))
    assert result["shop_drawing_filename"] == "Kitchen-Plan-Rev2.pdf"
    assert result["shop_drawing_size"] == len(b"%PDF-1.4 fake content")
    assert result["shop_drawing_uploaded_at"]

    updated = app_main.projects_col.find_one({"id": project["id"]})
    assert updated["shop_drawing_filename"] == "Kitchen-Plan-Rev2.pdf"
    assert updated["shop_drawing_size"] == len(b"%PDF-1.4 fake content")


def test_upload_shop_drawing_rejects_non_pdf():
    _reset()
    project = app_main.create_project()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(app_main.upload_shop_drawing(
            project["id"], FakeUploadFile("plan.docx", b"not a pdf"),
        ))
    assert exc.value.status_code == 400


def test_get_shop_drawing_file_returns_404_when_none_uploaded():
    _reset()
    project = app_main.create_project()
    with pytest.raises(HTTPException) as exc:
        app_main.get_shop_drawing_file(project["id"])
    assert exc.value.status_code == 404


def test_get_shop_drawing_file_returns_stored_bytes():
    _reset()
    project = app_main.create_project()
    content = b"%PDF-1.4 fake content"
    asyncio.run(app_main.upload_shop_drawing(project["id"], FakeUploadFile("plan.pdf", content)))
    resp = app_main.get_shop_drawing_file(project["id"])
    assert resp.body == content
    assert resp.media_type == "application/pdf"
    assert "inline" in resp.headers["content-disposition"]


def test_get_shop_drawing_file_download_flag_sets_attachment():
    _reset()
    project = app_main.create_project()
    content = b"%PDF-1.4 fake content"
    asyncio.run(app_main.upload_shop_drawing(project["id"], FakeUploadFile("plan.pdf", content)))
    resp = app_main.get_shop_drawing_file(project["id"], download=True)
    assert "attachment" in resp.headers["content-disposition"]


def test_reupload_replaces_rather_than_versions():
    _reset()
    project = app_main.create_project()
    asyncio.run(app_main.upload_shop_drawing(project["id"], FakeUploadFile("v1.pdf", b"old content")))
    asyncio.run(app_main.upload_shop_drawing(project["id"], FakeUploadFile("v2.pdf", b"new content, longer")))

    assert len(app_main.shop_drawings_col.find({"project_id": project["id"]})) == 1
    resp = app_main.get_shop_drawing_file(project["id"])
    assert resp.body == b"new content, longer"

    updated = app_main.projects_col.find_one({"id": project["id"]})
    assert updated["shop_drawing_filename"] == "v2.pdf"


def test_delete_shop_drawing_clears_file_and_project_metadata():
    _reset()
    project = app_main.create_project()
    asyncio.run(app_main.upload_shop_drawing(project["id"], FakeUploadFile("plan.pdf", b"content")))
    app_main.delete_shop_drawing(project["id"])

    with pytest.raises(HTTPException):
        app_main.get_shop_drawing_file(project["id"])
    updated = app_main.projects_col.find_one({"id": project["id"]})
    assert updated["shop_drawing_filename"] == ""


def test_project_response_exposes_shop_drawing_metadata():
    _reset()
    project = app_main.create_project()
    assert project["shop_drawing_filename"] == ""
    assert project["shop_drawing_size"] == 0
    assert project["shop_drawing_uploaded_at"] == ""

    asyncio.run(app_main.upload_shop_drawing(project["id"], FakeUploadFile("plan.pdf", b"content")))
    refreshed = app_main.project_response(app_main.projects_col.find_one({"id": project["id"]}))
    assert refreshed["shop_drawing_filename"] == "plan.pdf"
    assert refreshed["shop_drawing_size"] == len(b"content")
    assert refreshed["shop_drawing_uploaded_at"]
