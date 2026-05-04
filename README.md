# StoneDesk

StoneDesk is a full-stack application designed to help stone fabricators manage projects, calculate material requirements, and organize cut pieces into shipping crates.

## Features

*   **Project Management**: Create, edit, and organize multiple projects.
*   **Piece Entry**: Quickly add stone pieces with dimensions, edge profiles, sink cutouts, and location data.
*   **Live Calculations**: Automatic calculation of square footage and weight based on material and thickness.
*   **Smart Crating**: Auto-generate shipping crates based on weight limits and group by type or unit.
*   **Custom Crate Naming**: Select which attributes (Building, Floor, Flat, Category, etc.) should be used to name generated crates.
*   **Excel Export**: Download a multi-sheet Excel file containing line items, aggregated summaries, crate plans, and crate contents.

## Tech Stack

*   **Frontend**: React, Vite, Tailwind CSS, Axios
*   **Backend**: Python, FastAPI, SQLAlchemy, SQLite, openpyxl

## Getting Started (Docker)

The easiest way to run the application is using Docker Compose.

1.  Make sure you have Docker and Docker Compose installed.
2.  Open a terminal in the root directory of the project.
3.  Run the following command:

    ```bash
    docker-compose up --build
    ```

4.  The application will be available at:
    *   **Frontend**: http://localhost:5173
    *   **Backend API**: http://localhost:8000/docs (Swagger UI)

## Local Development Setup

If you prefer to run the application without Docker:

### Backend

1.  Navigate to the `backend` directory.
2.  Create a virtual environment: `python -m venv venv`
3.  Activate the environment: `source venv/bin/activate` (Mac/Linux) or `venv\Scripts\activate` (Windows)
4.  Install dependencies: `pip install -r requirements.txt`
5.  Start the server: `uvicorn app.main:app --reload`

### Frontend

1.  Navigate to the `frontend` directory.
2.  Install dependencies: `npm install`
3.  Start the dev server: `npm run dev`