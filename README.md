
# BuyMe - Online Vehicle Auction Platform

BuyMe is a full-featured online vehicle auction system built using Flask, MySQL, SQLAlchemy, and Celery. It supports user roles (buyer, seller, admin, CSR), bidding (manual and auto), alerts, Q&A, profile change requests, and scheduled tasks.

---

## 🔧 Requirements

- Python 3.8+
- MySQL Server
- Redis (for Celery)
- Virtualenv (recommended)

---

## 📦 Setup Instructions

### 1. Clone or Extract the Project
Unzip the project folder and navigate to it:

```bash
cd BuyMe
```

### 2. Create Virtual Environment and Install Dependencies

```bash
python -m venv venv
source venv/bin/activate  # on Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Setup MySQL Database

1. Create a MySQL user and database.
2. Import the schema:

```bash
mysql -u your_user -p buyme_db < buyme_db.sql
```

3. Update `Configure.py` with your DB username/password.

### 4. Run the Flask App

```bash
export FLASK_APP=website_creation.py
export FLASK_ENV=development
flask run
```

The site will be available at `http://127.0.0.1:5000`.

---

## ⏰ Run Celery for Scheduled Auction Closing

In a new terminal:

```bash
# Start the Celery worker
celery -A celery_app.celery worker --loglevel=info
```

And optionally:

```bash
# Start the Celery Beat scheduler (optional if periodic auction checks are used)
celery -A celery_app.celery beat --loglevel=info
```

---

## 👥 User Roles

- **User**: Register, bid, buy, sell
- **Admin**: Create CSRs, view earnings reports
- **CSR**: Manage questions, approve profile changes, remove users/bids/auctions

---

## 🧪 Testing Checklist

- [x] Register/Login/Logout
- [x] Create auction, place bid, auto-bid
- [x] Close auction and declare winner (via Celery)
- [x] Alerts and notifications
- [x] CSR and Admin dashboards
- [x] Q&A and profile change requests

---

## 📝 Credits

Developed as part of **CS 527 Database Systems** Project.

---

Happy Bidding! 🚗💨
