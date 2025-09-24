#!/usr/bin/env python3
"""
Test script for Attendance API endpoints

This script tests the basic functionality of the attendance system API
to ensure all endpoints are working correctly.
"""

import requests
import json
import sys
from datetime import datetime, date

# API Configuration
BASE_URL = "http://127.0.0.1:8700"
ATTENDANCE_BASE = f"{BASE_URL}/attendance"

def test_api_endpoint(method, endpoint, data=None, expected_status=200):
    """Test an API endpoint and return the response"""
    url = f"{ATTENDANCE_BASE}{endpoint}"
    
    try:
        if method.upper() == "GET":
            response = requests.get(url)
        elif method.upper() == "POST":
            response = requests.post(url, json=data)
        elif method.upper() == "PUT":
            response = requests.put(url, json=data)
        elif method.upper() == "DELETE":
            response = requests.delete(url)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        print(f"{method.upper()} {endpoint} - Status: {response.status_code}")
        
        if response.status_code == expected_status:
            print("✅ Success")
            try:
                return response.json()
            except:
                return response.text
        else:
            print(f"❌ Expected {expected_status}, got {response.status_code}")
            try:
                error_data = response.json()
                print(f"Error: {error_data}")
            except:
                print(f"Error: {response.text}")
            return None
            
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection failed to {url}")
        print("Make sure the backend server is running on port 8700")
        return None
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def main():
    """Run the attendance API tests"""
    print("🧪 Testing Attendance API Endpoints")
    print("=" * 50)
    
    # Test 1: Check if backend is running
    print("\n1. Testing backend connectivity...")
    try:
        response = requests.get(BASE_URL)
        if response.status_code == 200:
            print("✅ Backend is running")
        else:
            print("❌ Backend responded with error")
            return False
    except:
        print("❌ Backend is not running. Please start the backend server first.")
        return False
    
    # Test 2: Get settings (should work with default settings)
    print("\n2. Testing settings endpoint...")
    settings = test_api_endpoint("GET", "/settings")
    if not settings:
        return False
    
    # Test 3: Create a test group
    print("\n3. Testing group creation...")
    group_data = {
        "name": "Test Group",
        "type": "general",
        "description": "A test group for API testing"
    }
    group = test_api_endpoint("POST", "/groups", group_data, 200)
    if not group:
        return False
    
    group_id = group.get("id")
    print(f"Created group with ID: {group_id}")
    
    # Test 4: Get all groups
    print("\n4. Testing get groups...")
    groups = test_api_endpoint("GET", "/groups")
    if not groups or not isinstance(groups, list):
        return False
    
    # Test 5: Add a test member
    print("\n5. Testing member creation...")
    member_data = {
        "person_id": "test_person_001",
        "group_id": group_id,
        "name": "Test Person",
        "role": "Test Role",
        "employee_id": "EMP001"
    }
    member = test_api_endpoint("POST", "/members", member_data, 200)
    if not member:
        return False
    
    # Test 6: Get group members
    print("\n6. Testing get group members...")
    members = test_api_endpoint("GET", f"/groups/{group_id}/members")
    if not members or not isinstance(members, list):
        return False
    
    # Test 7: Add a test attendance record
    print("\n7. Testing attendance record creation...")
    record_data = {
        "person_id": "test_person_001",
        "type": "check_in",
        "confidence": 0.95,
        "is_manual": True,
        "notes": "Test check-in"
    }
    record = test_api_endpoint("POST", "/records", record_data, 200)
    if not record:
        return False
    
    # Test 8: Get attendance records
    print("\n8. Testing get attendance records...")
    records = test_api_endpoint("GET", f"/records?group_id={group_id}")
    if not records or not isinstance(records, list):
        return False
    
    # Test 9: Get group stats
    print("\n9. Testing group statistics...")
    stats = test_api_endpoint("GET", f"/groups/{group_id}/stats")
    if not stats:
        return False
    
    # Test 10: Process attendance event
    print("\n10. Testing attendance event processing...")
    event_data = {
        "person_id": "test_person_001",
        "confidence": 0.88
    }
    event = test_api_endpoint("POST", "/events", event_data, 200)
    if not event:
        return False
    
    # Test 11: Get database stats
    print("\n11. Testing database statistics...")
    db_stats = test_api_endpoint("GET", "/stats")
    if not db_stats:
        return False
    
    # Test 12: Update settings
    print("\n12. Testing settings update...")
    settings_update = {
        "confidence_threshold": 0.8,
        "late_threshold_minutes": 20
    }
    updated_settings = test_api_endpoint("PUT", "/settings", settings_update)
    if not updated_settings:
        return False
    
    # Cleanup: Remove test data
    print("\n13. Cleaning up test data...")
    test_api_endpoint("DELETE", f"/members/test_person_001")
    test_api_endpoint("DELETE", f"/groups/{group_id}")
    
    print("\n" + "=" * 50)
    print("🎉 All tests passed! The attendance API is working correctly.")
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)