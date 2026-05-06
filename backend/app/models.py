from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.sql import func
from .database import Base

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, default="")
    customer = Column(String, default="")
    job_number = Column(String, default="")
    material = Column(String, default="Granite")
    thickness = Column(String, default="3CM")
    date = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

class Piece(Base):
    __tablename__ = "pieces"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, default=1)
    part = Column(String)
    category = Column(String)
    drawing = Column(String, default="")
    length = Column(Float)
    width = Column(Float)
    qty = Column(Integer, default=1)
    unit = Column(String, default="")
    edge = Column(String, default="")
    radius = Column(Float, default=0)
    sink_type = Column(String, default="No Sink")
    sink_cut = Column(Integer, default=0)
    tap_holes = Column(Integer, default=0)
    grooves = Column(Integer, default=0)
    notes = Column(String, default="")
    building = Column(String, default="")
    floor = Column(String, default="")
    flat = Column(String, default="")
    edge_area = Column(String, default="")
    edge_polish_machine = Column(Float, default=0.0)
    created_at = Column(DateTime, default=func.now())

class Crate(Base):
    __tablename__ = "crates"
    id = Column(Integer, primary_key=True, index=True)
    crate_id = Column(String, unique=True, index=True)
    name = Column(String)
    max_weight = Column(Float, default=1000)
    internal_length = Column(Float, default=0.0)
    internal_width = Column(Float, default=0.0)
    internal_height = Column(Float, default=0.0)
    external_length = Column(Float, default=0.0)
    external_width = Column(Float, default=0.0)
    external_height = Column(Float, default=0.0)
    sqft = Column(Float, default=0.0)
    weight = Column(Float, default=0.0)
    created_at = Column(DateTime, default=func.now())

class Assignment(Base):
    __tablename__ = "assignments"
    id = Column(Integer, primary_key=True, index=True)
    piece_id = Column(Integer, ForeignKey("pieces.id"))
    crate_id = Column(Integer, ForeignKey("crates.id"))
    assigned_at = Column(DateTime, default=func.now())
