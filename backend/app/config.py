from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    cors_origins: str = "http://localhost:3000"
    # Frontend (Vercel) and backend (Render) are different sites in production, so the
    # session cookie needs SameSite=None + Secure there; locally both run on localhost
    # (same site regardless of port), where Secure would silently drop the cookie.
    cookie_secure: bool = False
    cookie_samesite: str = "lax"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]


settings = Settings()
