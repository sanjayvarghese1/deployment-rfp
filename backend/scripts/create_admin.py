#!/usr/bin/env python3
"""
Create a Supabase auth user (using the service role key) and insert a profiles row with role='admin'.

Environment variables required:
- NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
- SUPABASE_SERVICE_ROLE_KEY
- ADMIN_EMAIL
- ADMIN_PASSWORD
- ADMIN_USERNAME (optional, default: "admin")

Run: python backend/scripts/create_admin.py
"""
import os
import sys
import requests

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")

if not SUPABASE_URL or not SERVICE_ROLE_KEY or not ADMIN_EMAIL or not ADMIN_PASSWORD:
    print("Missing required env vars. Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL and ADMIN_PASSWORD.")
    sys.exit(1)

HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}

def create_auth_user(email: str, password: str) -> dict:
    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/admin/users"
    payload = {"email": email, "password": password, "email_confirm": True}
    resp = requests.post(url, headers=HEADERS, json=payload)
    resp.raise_for_status()
    return resp.json()

def insert_profile(profile: dict) -> dict:
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/profiles"
    # Prefer representation to get the created row back
    headers = HEADERS.copy()
    headers["Prefer"] = "return=representation"
    resp = requests.post(url, headers=headers, json=profile)
    resp.raise_for_status()
    return resp.json()

def main():
    print("Creating admin user...")
    user = create_auth_user(ADMIN_EMAIL, ADMIN_PASSWORD)
    user_id = user.get("id")
    if not user_id:
        print("No user id returned from auth creation. Response:", user)
        sys.exit(1)

    profile = {"id": user_id, "email": ADMIN_EMAIL, "username": ADMIN_USERNAME, "role": "admin"}
    created = insert_profile(profile)
    print("Admin profile created:")
    print(created)

if __name__ == "__main__":
    main()
