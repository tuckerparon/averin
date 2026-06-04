#!/usr/bin/env python3
"""Load Synthea FHIR bundles into Azure Health Data Services, resolving internal references."""

import json
import os
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

FHIR_BASE = os.environ["AZURE_FHIR_URL"].rstrip("/")
TENANT_ID = os.environ["AZURE_FHIR_TENANT_ID"]
CLIENT_ID = os.environ["AZURE_FHIR_CLIENT_ID"]
CLIENT_SECRET = os.environ["AZURE_FHIR_CLIENT_SECRET"]

_token_cache: dict = {"token": None, "expires_at": 0}


def get_token() -> str:
    """Fetch Azure AD access token for FHIR scope."""
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"
    resp = requests.post(url, data={
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "scope": f"{FHIR_BASE}/.default",
    })
    resp.raise_for_status()
    result = resp.json()
    _token_cache["token"] = result["access_token"]
    _token_cache["expires_at"] = now + result.get("expires_in", 3600)
    return _token_cache["token"]


def get_headers() -> dict:
    return {
        "Authorization": f"Bearer {get_token()}",
        "Content-Type": "application/fhir+json",
        "Accept": "application/fhir+json",
    }


HEADERS = {}  # populated dynamically via get_headers()

PRIORITY_TYPES = ["Organization", "Location", "Practitioner", "PractitionerRole", "Patient"]
SKIP_TYPES = ["Provenance"]


def scan_bundle(entries: list, ref_map: dict) -> None:
    """Add all resolvable refs from this bundle into ref_map."""
    for entry in entries:
        resource = entry.get("resource", {})
        full_url = entry.get("fullUrl", "")
        rtype = resource.get("resourceType", "")
        rid = resource.get("id", "")
        if full_url and rtype and rid:
            ref_map[full_url] = f"{rtype}/{rid}"
        if rtype and rid:
            for ident in resource.get("identifier", []):
                system = ident.get("system", "")
                value = ident.get("value", "")
                if system and value:
                    ref_map[f"{rtype}?identifier={system}|{value}"] = f"{rtype}/{rid}"


def replace_refs(obj, ref_map: dict):
    """Recursively replace FHIR references. Strip unresolvable conditional refs."""
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            if k == "reference" and isinstance(v, str):
                resolved = ref_map.get(v)
                if resolved:
                    result[k] = resolved
                elif "?" in v:
                    pass  # strip unresolvable conditional reference
                else:
                    result[k] = v
            else:
                replaced = replace_refs(v, ref_map)
                if replaced is not None:
                    result[k] = replaced
        return result
    if isinstance(obj, list):
        return [replace_refs(item, ref_map) for item in obj if replace_refs(item, ref_map) is not None]
    return obj


def post_resource(resource: dict) -> bool:
    rtype = resource.get("resourceType")
    rid = resource.get("id")
    if not rtype:
        return False
    headers = get_headers()
    if rid:
        resp = requests.put(f"{FHIR_BASE}/{rtype}/{rid}", json=resource, headers=headers)
    else:
        resp = requests.post(f"{FHIR_BASE}/{rtype}", json=resource, headers=headers)
    if resp.status_code not in (200, 201):
        print(f"  WARN {resp.status_code} {rtype}/{rid}: {resp.text[:150]}")
        return False
    return True


def load_bundle(path: Path, ref_map: dict) -> tuple[int, int]:
    with open(path) as f:
        bundle = json.load(f)
    entries = bundle.get("entry", [])
    resources = [replace_refs(e["resource"], ref_map) for e in entries if "resource" in e]
    priority = [r for r in resources if r.get("resourceType") in PRIORITY_TYPES]
    rest = [r for r in resources if r.get("resourceType") not in PRIORITY_TYPES + SKIP_TYPES]
    ok = fail = 0
    for resource in priority + rest:
        if post_resource(resource):
            ok += 1
        else:
            fail += 1
    return ok, fail


def main():
    fhir_dir = Path(__file__).parent.parent / "output" / "fhir"
    files = sorted(fhir_dir.glob("*.json"))
    print(f"Found {len(files)} bundles. Building global reference map...")

    # Pass 1: build global ref map across all bundles
    global_ref_map = {}
    for path in files:
        if path.stat().st_size == 0:
            continue
        try:
            with open(path) as f:
                bundle = json.load(f)
            scan_bundle(bundle.get("entry", []), global_ref_map)
        except json.JSONDecodeError as e:
            print(f"  SKIP (bad JSON) {path.name}: {e}")
    print(f"Reference map: {len(global_ref_map)} entries\n")

    # Pass 2: load each bundle
    total_ok = total_fail = 0
    for i, path in enumerate(files, 1):
        if path.stat().st_size == 0:
            print(f"[{i}/{len(files)}] SKIP (empty) {path.name}")
            continue
        print(f"[{i}/{len(files)}] {path.name}")
        try:
            ok, fail = load_bundle(path, global_ref_map)
        except json.JSONDecodeError as e:
            print(f"  SKIP (bad JSON): {e}")
            continue
        total_ok += ok
        total_fail += fail
        print(f"  {ok} ok, {fail} failed")

    print(f"\nDone. {total_ok} resources loaded, {total_fail} failed.")


if __name__ == "__main__":
    main()
