> A plugin for [Voiden](https://github.com/VoidenHQ) — the developer-first API client.

# OpenAPI Collection Importer

Import OpenAPI v3.0 collections and convert them into native Voiden request files — folder structure, headers, query params, auth, and all body types included.

## Features

- Import OpenAPI v3.0 JSON files
- Automatically creates folder structure matching the collection hierarchy
- Converts requests to native `.void` files
- Supports all HTTP methods
- Imports headers and converts them to headers-table blocks
- Imports query parameters and converts them to query-table blocks
- Imports JSON bodies, form-data, and URL-encoded bodies
- Sanitizes file and folder names for filesystem compatibility
- Nested folder support (unlimited depth)

## Usage

Click the **Import OpenAPI** button in the left sidebar, select a `.json` OpenAPI v3.0 file, and the importer will create a matching folder tree under your active project.

## Preview a mock response

Expand an imported endpoint, choose a documented response status, then copy the generated JSON response. The preview uses an explicit example first and otherwise generates a small value from the response schema. This first version supports `application/json` and `application/*+json` responses.
