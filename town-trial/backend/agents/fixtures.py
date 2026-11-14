"""Placeholder evidence used when live Exa / past.dev are unavailable (and in M1).

Every fixture is labelled FIXTURE in its title and uses a fixture:// URL, so it
can never be mistaken for a real source. Mirrors web/js/research.js.
"""


def library_hours(city: str) -> list[dict]:
    return [{"title": f"{city} Public Library: hours and locations (FIXTURE)", "url": "fixture://library-hours",
             "passage": "Mon-Sat 10:00-18:00. Closed Sunday."}]


def board_minutes(city: str) -> list[dict]:
    return [{"title": f"{city} Library Board minutes, Oct 2026 (FIXTURE)", "url": "fixture://board-minutes",
             "passage": "No additional staff hours approved for FY2027. Schedule changes must stay within current staffing."}]


def library_news(city: str) -> list[dict]:
    return [{"title": f"{city} Library news page (FIXTURE)", "url": "fixture://library-news",
             "passage": "Hours updates are posted on the website and social media."}]


def school_bulletin(city: str) -> list[dict]:
    return [{"title": f"{city} Elementary: Friday family folder (FIXTURE)", "url": "fixture://school-bulletin",
             "passage": "A weekly bulletin goes home with every student on Fridays and by email to families."}]
