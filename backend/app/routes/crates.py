from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/crates", tags=["crates"])

class CrateStrategyRequest(BaseModel):
    group_by: str
    max_pieces: Optional[int] = None
    max_weight: Optional[float] = None

@router.get("/")
def get_crates(db: Session = Depends(get_db)):
    return db.query(models.Crate).all()

@router.post("/")
def create_crate(crate: schemas.CrateCreate, db: Session = Depends(get_db)):
    last_crate = db.query(models.Crate).order_by(models.Crate.id.desc()).first()
    next_num = int(last_crate.crate_id[2:]) + 1 if last_crate else 1
    crate_id = f"CR{next_num:04d}"
    db_crate = models.Crate(crate_id=crate_id, **crate.dict())
    db.add(db_crate)
    db.commit()
    db.refresh(db_crate)
    return db_crate

@router.post("/auto-generate")
def auto_generate(strategy: CrateStrategyRequest, db: Session = Depends(get_db)):
    from ..services.crate_strategy import auto_generate_crates, estimate_crate_dimensions
    
    project = db.query(models.Project).first()
    if not project:
        project = models.Project()
        db.add(project)
        db.commit()
    
    pieces = db.query(models.Piece).all()
    if not pieces:
        return {"message": "No pieces to crate"}
    
    db.query(models.Assignment).delete()
    db.query(models.Crate).delete()
    
    crate_groups = auto_generate_crates(
        pieces=pieces, 
        strategy=strategy.group_by,
        max_pieces=strategy.max_pieces, 
        max_weight=strategy.max_weight,
        material=project.material, 
        thickness=project.thickness
    )
    
    for crate_name, crate_pieces in crate_groups:
        last_crate = db.query(models.Crate).order_by(models.Crate.id.desc()).first()
        next_num = int(last_crate.crate_id[2:]) + 1 if last_crate else 1
        crate_id = f"CR{next_num:04d}"
        dims = estimate_crate_dimensions(crate_pieces, project.material, project.thickness, strategy.max_weight or 1000)
        
        db_crate = models.Crate(
            crate_id=crate_id, 
            name=crate_name, 
            max_weight=strategy.max_weight or 1000,
            internal_length=dims["internal_length"],
            internal_width=dims["internal_width"],
            internal_height=dims["internal_height"],
            external_length=dims["external_length"],
            external_width=dims["external_width"],
            external_height=dims["external_height"],
            sqft=dims["sqft"],
            weight=dims["weight"],
        )
        db.add(db_crate)
        db.flush()
        
        for piece in crate_pieces:
            assignment = models.Assignment(piece_id=piece.id, crate_id=db_crate.id)
            db.add(assignment)
    
    db.commit()
    return {"message": f"Created {len(crate_groups)} crates"}

@router.delete("/{crate_id}")
def delete_crate(crate_id: int, db: Session = Depends(get_db)):
    crate = db.query(models.Crate).filter(models.Crate.id == crate_id).first()
    if not crate:
        raise HTTPException(status_code=404, detail="Crate not found")
    db.query(models.Assignment).filter(models.Assignment.crate_id == crate_id).delete()
    db.delete(crate)
    db.commit()
    return {"message": "Crate deleted"}

@router.delete("/")
def delete_all_crates(db: Session = Depends(get_db)):
    db.query(models.Assignment).delete()
    db.query(models.Crate).delete()
    db.commit()
    return {"message": "All crates deleted"}

@router.post("/assign")
def assign_piece(assignment: schemas.AssignmentCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Assignment).filter(models.Assignment.piece_id == assignment.piece_id).first()
    if existing:
        existing.crate_id = assignment.crate_id
    else:
        db.add(models.Assignment(**assignment.dict()))
    db.commit()
    return {"message": "Assigned"}

@router.get("/assignments")
def get_assignments(db: Session = Depends(get_db)):
    return db.query(models.Assignment).all()
