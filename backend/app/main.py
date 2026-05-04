from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import date
import openpyxl
from io import BytesIO
from pydantic import BaseModel
from typing import List

# Database
engine = create_engine('sqlite:///./stonedesk.db', connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class PieceCreate(BaseModel):
    part: str
    category: str
    drawing: str = ""
    length: float
    width: float
    qty: int = 1
    unit: str = ""
    building: str = ""
    floor: str = ""
    flat: str = ""
    sink_type: str = "No Sink"
    sink_cut: str = "-"
    tap_holes: str = "-"
    grooves: str = "-"
    edge: str = "None"
    radius: str = "-"
    notes: str = ""

class ProjectUpdate(BaseModel):
    name: str
    material: str
    thickness: str
    customer: str
    job_number: str
    date: str

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    name = Column(String, default="New Project")
    material = Column(String, default="Granite")
    thickness = Column(String, default="3CM")
    customer = Column(String, default="")
    job_number = Column(String, default="")
    date = Column(String, default=lambda: date.today().isoformat())

class Piece(Base):
    __tablename__ = "pieces"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    part = Column(String)
    category = Column(String)
    drawing = Column(String, default="")
    length = Column(Float)
    width = Column(Float)
    qty = Column(Integer, default=1)
    unit = Column(String, default="")
    building = Column(String, default="")
    floor = Column(String, default="")
    flat = Column(String, default="")
    sink_type = Column(String, default="No Sink")
    sink_cut = Column(String, default="-")
    tap_holes = Column(String, default="-")
    grooves = Column(String, default="-")
    edge = Column(String, default="None")
    radius = Column(String, default="-")
    notes = Column(String, default="")

class Crate(Base):
    __tablename__ = "crates"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    crate_id = Column(String, unique=True)
    name = Column(String)
    max_weight = Column(Float, default=1000)

class Assignment(Base):
    __tablename__ = "assignments"
    id = Column(Integer, primary_key=True)
    piece_id = Column(Integer)
    crate_id = Column(Integer)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routes
@app.get("/api/projects/")
def get_projects():
    db = SessionLocal()
    projects = db.query(Project).all()
    res = [{"id": p.id, "name": p.name, "customer": p.customer, "date": p.date, "material": p.material} for p in projects]
    db.close()
    return res

@app.post("/api/projects/")
def create_project():
    db = SessionLocal()
    p = Project(name="", date=date.today().isoformat())
    db.add(p)
    db.commit()
    db.refresh(p)
    res = {"id": p.id, "name": p.name}
    db.close()
    return res

@app.get("/api/projects/{project_id}")
def get_project(project_id: int):
    db = SessionLocal()
    p = db.query(Project).filter(Project.id == project_id).first()
    res = {"id": p.id, "name": p.name, "material": p.material, "thickness": p.thickness, "customer": p.customer, "job_number": p.job_number, "date": p.date} if p else None
    db.close()
    return res

@app.put("/api/projects/{project_id}")
def update_project(project_id: int, data: ProjectUpdate):
    db = SessionLocal()
    p = db.query(Project).filter(Project.id == project_id).first()
    if p:
        for key, value in data.dict().items():
            setattr(p, key, value)
        db.commit()
    db.close()
    return {"message": "ok"}

@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int):
    db = SessionLocal()
    db.query(Piece).filter(Piece.project_id == project_id).delete()
    crates = db.query(Crate).filter(Crate.project_id == project_id).all()
    crate_ids = [c.id for c in crates]
    if crate_ids:
        db.query(Assignment).filter(Assignment.crate_id.in_(crate_ids)).delete(synchronize_session=False)
    db.query(Crate).filter(Crate.project_id == project_id).delete()
    db.query(Project).filter(Project.id == project_id).delete()
    db.commit()
    db.close()
    return {"message": "ok"}

@app.get("/api/projects/{project_id}/pieces/")
def get_pieces(project_id: int):
    db = SessionLocal()
    pieces = db.query(Piece).filter(Piece.project_id == project_id).all()
    db.close()
    return [
        {
            "id": p.id, "part": p.part, "category": p.category, "drawing": p.drawing,
            "length": p.length, "width": p.width, "qty": p.qty, "unit": p.unit,
            "building": p.building, "floor": p.floor, "flat": p.flat,
            "sink_type": p.sink_type, "sink_cut": p.sink_cut, "tap_holes": p.tap_holes,
            "grooves": p.grooves, "edge": p.edge, "radius": p.radius, "notes": p.notes
        } for p in pieces
    ]

@app.post("/api/projects/{project_id}/pieces/batch")
def create_pieces_batch(project_id: int, pieces_data: List[PieceCreate]):
    db = SessionLocal()
    for p in pieces_data:
        piece = Piece(**p.dict(), project_id=project_id)
        db.add(piece)
    db.commit()
    db.close()
    return {"message": "ok"}

@app.delete("/api/projects/{project_id}/pieces/")
def delete_all_pieces(project_id: int):
    db = SessionLocal()
    pieces = db.query(Piece).filter(Piece.project_id == project_id).all()
    piece_ids = [p.id for p in pieces]
    if piece_ids:
        db.query(Assignment).filter(Assignment.piece_id.in_(piece_ids)).delete(synchronize_session=False)
    db.query(Piece).filter(Piece.project_id == project_id).delete()
    db.commit()
    db.close()
    return {"message": "ok"}

@app.delete("/api/pieces/{piece_id}")
def delete_piece(piece_id: int):
    db = SessionLocal()
    db.query(Assignment).filter(Assignment.piece_id == piece_id).delete(synchronize_session=False)
    db.query(Piece).filter(Piece.id == piece_id).delete()
    db.commit()
    db.close()
    return {"message": "ok"}

@app.get("/api/projects/{project_id}/crates/")
def get_crates(project_id: int):
    db = SessionLocal()
    crates = db.query(Crate).filter(Crate.project_id == project_id).all()
    db.close()
    return [{"id": c.id, "crate_id": c.crate_id, "name": c.name, "max_weight": c.max_weight} for c in crates]

@app.post("/api/projects/{project_id}/crates/")
def create_crate(project_id: int, data: dict):
    db = SessionLocal()
    last = db.query(Crate).order_by(Crate.id.desc()).first()
    next_num = int(last.crate_id[2:]) + 1 if last else 1
    crate_id = f"CR{next_num:04d}"
    crate = Crate(crate_id=crate_id, name=data.get("name"), max_weight=data.get("max_weight", 1000), project_id=project_id)
    db.add(crate)
    db.commit()
    db.close()
    return {"id": crate.id, "crate_id": crate.crate_id}

@app.post("/api/projects/{project_id}/crates/auto-generate")
def auto_generate(project_id: int, data: dict):
    db = SessionLocal()
    pieces = db.query(Piece).filter(Piece.project_id == project_id).all()
    if not pieces:
        return {"message": "no pieces"}
    
    # Delete existing crates and assignments for this project
    crates = db.query(Crate).filter(Crate.project_id == project_id).all()
    crate_ids = [c.id for c in crates]
    if crate_ids:
        db.query(Assignment).filter(Assignment.crate_id.in_(crate_ids)).delete(synchronize_session=False)
    db.query(Crate).filter(Crate.project_id == project_id).delete()
    
    strategy = data.get("group_by", "type")
    
    try:
        max_weight = float(data.get("max_weight", 1000.0))
    except (TypeError, ValueError):
        max_weight = 1000.0
        
    factors = {
        'Granite': {'2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5},
        'Quartz': {'2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75},
        'Marble': {'2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0},
        'Other': {'2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5},
    }
    project = db.query(Project).filter(Project.id == project_id).first()
    factor = factors.get(project.material, factors['Other']).get(project.thickness, 7.5)
    
    groups = {}
    for p in pieces:
        if strategy == "unit":
            key_parts = [p.building, p.floor, p.flat]
            key = "-".join(part for part in key_parts if part)
            if not key: key = "Uncategorized Unit"
        else: # strategy == "type"
            key = p.category or "Uncategorized Type"
        groups.setdefault(key, []).append(p)

    # Get starting number for new crates
    last_crate = db.query(Crate).order_by(Crate.id.desc()).first()
    next_num = 1
    if last_crate and last_crate.crate_id.startswith("CR"):
        try:
            next_num = int(last_crate.crate_id[2:]) + 1
        except:
            pass

    for group_key, group in groups.items():
        current_pieces = []
        current_weight = 0.0
        
        group.sort(key=lambda p: (p.length * p.width * p.qty), reverse=True)
        
        for p in group:
            p_weight = ((p.length * p.width) / 144.0) * factor * p.qty
            if current_weight + p_weight > max_weight and current_pieces: 
                # Create a name where suffix matches the ID (e.g. CR0011 -> Name-11)
                name = f"{group_key}-{next_num:02d}"
                crate = Crate(crate_id=f"CR{next_num:04d}", name=name, max_weight=max_weight, project_id=project_id)
                db.add(crate)
                db.flush()
                for cp in current_pieces:
                    db.add(Assignment(piece_id=cp.id, crate_id=crate.id))
                
                next_num += 1
                current_pieces = []
                current_weight = 0.0
            
            current_pieces.append(p)
            current_weight += p_weight
        
        # After iterating through all pieces in a group, add any remaining pieces to a crate
        if current_pieces:
            name = f"{group_key}-{next_num:02d}"
            crate = Crate(crate_id=f"CR{next_num:04d}", name=name, max_weight=max_weight, project_id=project_id)
            db.add(crate)
            db.flush()
            for cp in current_pieces:
                db.add(Assignment(piece_id=cp.id, crate_id=crate.id))
            next_num += 1
    
    db.commit()
    db.close()
    return {"message": "ok"}

@app.delete("/api/projects/{project_id}/crates/")
def delete_all_crates(project_id: int):
    db = SessionLocal()
    crates = db.query(Crate).filter(Crate.project_id == project_id).all()
    crate_ids = [c.id for c in crates]
    if crate_ids:
        db.query(Assignment).filter(Assignment.crate_id.in_(crate_ids)).delete(synchronize_session=False)
    db.query(Crate).filter(Crate.project_id == project_id).delete()
    db.commit()
    db.close()
    return {"message": "ok"}

@app.delete("/api/crates/{crate_id}")
def delete_crate(crate_id: int):
    db = SessionLocal()
    db.query(Assignment).filter(Assignment.crate_id == crate_id).delete(synchronize_session=False)
    db.query(Crate).filter(Crate.id == crate_id).delete(synchronize_session=False)
    db.commit()
    db.close()
    return {"message": "ok"}

@app.post("/api/crates/assign")
def assign_piece(data: dict):
    db = SessionLocal()
    existing = db.query(Assignment).filter(Assignment.piece_id == data["piece_id"]).first()
    if existing:
        existing.crate_id = data["crate_id"]
    else:
        db.add(Assignment(piece_id=data["piece_id"], crate_id=data["crate_id"]))
    db.commit()
    db.close()
    return {"message": "ok"}

@app.get("/api/projects/{project_id}/crates/assignments")
def get_assignments(project_id: int):
    db = SessionLocal()
    crates = db.query(Crate).filter(Crate.project_id == project_id).all()
    crate_ids = [c.id for c in crates]
    assignments = db.query(Assignment).filter(Assignment.crate_id.in_(crate_ids)).all() if crate_ids else []
    db.close()
    return [{"piece_id": a.piece_id, "crate_id": a.crate_id} for a in assignments]

@app.get("/api/projects/{project_id}/export")
def export_excel(project_id: int):
    db = SessionLocal()
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return {"message": "project not found"}
    
    pieces = db.query(Piece).filter(Piece.project_id == project_id).all()
    crates = db.query(Crate).filter(Crate.project_id == project_id).all()
    crate_ids = [c.id for c in crates]
    assignments = db.query(Assignment).filter(Assignment.crate_id.in_(crate_ids)).all() if crate_ids else []
    db.close()
    
    assign_map = {a.piece_id: a.crate_id for a in assignments}
    
    factors = {
        'Granite': {'2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5},
        'Quartz': {'2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75},
        'Marble': {'2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0},
        'Other': {'2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5},
    }
    factor = factors.get(project.material, factors['Other']).get(project.thickness, 7.5)
    
    wb = openpyxl.Workbook()
    
    ws1 = wb.active
    ws1.title = "Line Items"
    ws1.append(["#", "Part Description", "Category", "Material", "Thickness", "Drawing #", "Unit Name", "Length (in)", "Depth (in)", "Qty", "Sink Type", "Cutouts", "Tap Holes", "Grooves", "Edge Polish", "Radius", "Sq Ft (ea)", "Sq Ft (tot)", "Wt ea (kg)", "Wt tot (kg)", "Building", "Floor", "Flat", "Notes"])
    for i, p in enumerate(pieces, 1):
        sqft = (p.length * p.width) / 144
        ws1.append([i, p.part, p.category, project.material, project.thickness, p.drawing or "", p.unit or "", p.length, p.width, p.qty, p.sink_type, p.sink_cut or "-", p.tap_holes or "-", p.grooves or "-", p.edge or "-", p.radius or "-", round(sqft, 2), round(sqft * p.qty, 2), round(sqft * factor, 2), round(sqft * factor * p.qty, 2), p.building or "", p.floor or "", p.flat or "", p.notes or ""])
    
    ws2 = wb.create_sheet("Aggregated Summary")
    ws2.append(["Part Description", "Category", "Material", "Thickness", "Drawings", "Total Pieces", "Total Sq Ft", "Total Weight (kg)"])
    groups = {}
    for p in pieces:
        k = (p.part, p.category)
        if k not in groups:
            groups[k] = {'drawings': set(), 'qty': 0, 'sqft': 0.0, 'weight': 0.0}
        if p.drawing:
            groups[k]['drawings'].add(p.drawing)
        groups[k]['qty'] += p.qty
        sq = (p.length * p.width) / 144
        groups[k]['sqft'] += sq * p.qty
        groups[k]['weight'] += sq * factor * p.qty
    for (part, cat), data in groups.items():
        ws2.append([part, cat, project.material, project.thickness, len(data['drawings']), data['qty'], round(data['sqft'], 2), round(data['weight'], 2)])

    ws3 = wb.create_sheet("Crate_Plan")
    ws3.append(["Crate #", "Crate Name", "Project", "Max Kg", "Total Kg", "Items", "Assigned By", "Date"])
    for c in crates:
        c_pieces = [p for p in pieces if assign_map.get(p.id) == c.id]
        total_kg = sum((((p.length * p.width) / 144) * factor * p.qty) for p in c_pieces)
        ws3.append([c.crate_id, c.name, project.name, c.max_weight, round(total_kg, 2), len(c_pieces), "System", date.today().isoformat()])
    
    ws4 = wb.create_sheet("Crate Items")
    ws4.append(["Crate #", "Crate Name", "Record ID", "Project", "Drawing", "Part #", "Description", "Building", "Floor", "Flat", "Qty", "Wt ea (kg)", "Line Wt (kg)"])
    for c in crates:
        c_pieces = [p for p in pieces if assign_map.get(p.id) == c.id]
        for p in c_pieces:
            sqft = (p.length * p.width) / 144
            wt_ea = sqft * factor
            ws4.append([c.crate_id, c.name, p.id, project.name, p.drawing or "", p.part, p.category, p.building or "", p.floor or "", p.flat or "", p.qty, round(wt_ea, 2), round(wt_ea * p.qty, 2)])
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename=StoneDesk_{date.today()}.xlsx"})