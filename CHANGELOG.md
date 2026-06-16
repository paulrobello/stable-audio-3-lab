# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Prominent "Stable Audio 3 Lab" link (pill button) in the radio page header for quick navigation back to the lab. Replaces the previous small label-style text link.

### Fixed
- Lab page "Radio queue" dropdown now lists every available station, including custom stations created on the radio page. Previously it only rendered the five built-in styles because it mapped over the static `radioStyles` constant instead of the live radio state.
- Removed an unused variable in the radio draft-track generation flow.
