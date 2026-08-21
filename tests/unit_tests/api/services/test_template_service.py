"""Unit tests for the template service and template API routes."""

import tempfile
from pathlib import Path

import pytest
import yaml

from datus.api.routes import template_routes
from datus.api.services.template_service import TemplateService

# Minimal valid template file content for isolated test dirs.
_MINIMAL_TEMPLATE = {
    "id": "test-template",
    "name": "测试模板",
    "description": "测试使用的模板",
    "heading": "测试标题",
    "subtitle": "测试副标题",
    "inputPlaceholder": "测试输入占位",
    "fileUpload": False,
    "outputOptions": [],
    "quickActions": [],
}


@pytest.fixture()
def template_service(tmp_path: Path) -> TemplateService:
    """A TemplateService backed by a temp dir containing one template."""
    (tmp_path / "test-template.yaml").write_text(yaml.safe_dump(_MINIMAL_TEMPLATE), encoding="utf-8")
    return TemplateService(templates_dir=str(tmp_path))


def test_loads_minimal_template(template_service: TemplateService):
    assert len(template_service.list_templates()) == 1
    template = template_service.get_template("test-template")
    assert template is not None
    assert template.name == "测试模板"
    assert template.heading == "测试标题"


def test_missing_template_returns_none(template_service: TemplateService):
    assert template_service.get_template("does-not-exist") is None


def test_invalid_yaml_is_skipped(tmp_path: Path):
    (tmp_path / "bad.yaml").write_text("id: [unclosed", encoding="utf-8")
    (tmp_path / "good.yaml").write_text(yaml.safe_dump(_MINIMAL_TEMPLATE), encoding="utf-8")
    svc = TemplateService(templates_dir=str(tmp_path))
    assert len(svc.list_templates()) == 1
    assert svc.get_template("test-template") is not None


def test_default_templates_directory_exists():
    """The packaged conf/templates directory ships with the 5 canonical templates."""
    svc = TemplateService()
    ids = {t.id for t in svc.list_templates()}
    assert {"contract-review", "contract-writing", "data-analysis", "db-query", "data-collection"} <= ids


def test_routes_list_and_get(template_service: TemplateService):
    template_routes.set_template_service(template_service)

    paths = [r.path for r in template_routes.router.routes]
    assert f"{template_routes.router.prefix}/list" in paths
    assert f"{template_routes.router.prefix}/{{template_id}}" in paths