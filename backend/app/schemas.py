from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime

class ProjectBase(BaseModel):
    name: str = ""
    customer: str = ""
    job_number: str = ""
    material: str = "Granite"
    thickness: str = "3CM"
    date: Optional[date] = None

class ProjectCreate(ProjectBase):
    pass

class ProjectResponse(ProjectBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True

class PieceBase(BaseModel):
    part: str
    category: str
    drawing: str = ""
    length: float
    width: float
    qty: int = 1
    unit: str = ""
    edge: str = ""
    radius: float = 0
    sink_type: str = "No Sink"
    sink_cut: int = 0
    tap_holes: int = 0
    grooves: int = 0
    notes: str = ""
    building: str = ""
    floor: str = ""
    flat: str = ""
    edge_area: str = ""
    edge_polish_machine: float = 0.0

class PieceCreate(PieceBase):
    project_id: int = 1

class PieceResponse(PieceBase):
    id: int
    project_id: int
    class Config:
        from_attributes = True

class CrateBase(BaseModel):
    name: str
    max_weight: float = 1000
    internal_length: float = 0.0
    internal_width: float = 0.0
    internal_height: float = 0.0
    external_length: float = 0.0
    external_width: float = 0.0
    external_height: float = 0.0
    sqft: float = 0.0
    weight: float = 0.0

class CrateCreate(CrateBase):
    pass

class CrateResponse(CrateBase):
    id: int
    crate_id: str
    class Config:
        from_attributes = True

class CrateStrategy(BaseModel):
    group_by: str
    max_pieces: Optional[int] = None
    max_weight: Optional[float] = None
    naming_format: Optional[List[str]] = None

class AssignmentCreate(BaseModel):
    piece_id: int
    crate_id: int
