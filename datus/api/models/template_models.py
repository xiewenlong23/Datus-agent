"""
Pydantic models for task template configuration.
"""

from typing import List, Optional
from pydantic import BaseModel


class OutputOptionValue(BaseModel):
    value: str
    label: str


class OutputOptionGroup(BaseModel):
    key: str
    label: str
    options: List[OutputOptionValue]


class QuickAction(BaseModel):
    title: str
    tags: List[str]
    description: str
    prompt: str


class TaskTemplate(BaseModel):
    id: str
    name: str
    description: str
    heading: str
    subtitle: str
    inputPlaceholder: str
    fileUpload: bool = False
    outputOptions: List[OutputOptionGroup] = []
    quickActions: List[QuickAction] = []


class TemplateListResponse(BaseModel):
    templates: List[TaskTemplate]