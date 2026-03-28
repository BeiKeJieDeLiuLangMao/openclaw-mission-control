"""
Memory utilities for mission-control.

Provides Mem0 client initialization and configuration management.
"""

import hashlib
import json
import os
import socket
from typing import Any, Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.memory.models import Turn, VectorMemory

_memory_client: Optional[Any] = None
_config_hash: Optional[str] = None


def _get_config_hash(config_dict: dict) -> str:
    """Generate a hash of the config to detect changes."""
    config_str = json.dumps(config_dict, sort_keys=True)
    return hashlib.md5(config_str.encode()).hexdigest()


def _get_docker_host_url() -> str:
    """
    Determine the appropriate host URL to reach host machine from inside Docker container.
    Returns the best available option for reaching the host from inside a container.
    """
    # Check for custom environment variable first
    custom_host = os.environ.get('OLLAMA_HOST')
    if custom_host:
        return custom_host.replace('http://', '').replace('https://', '').split(':')[0]

    # Check if we're running inside Docker
    if not os.path.exists('/.dockerenv'):
        return "localhost"

    # Try different host resolution strategies
    host_candidates = []

    # 1. host.docker.internal (works on Docker Desktop for Mac/Windows)
    try:
        socket.gethostbyname('host.docker.internal')
        host_candidates.append('host.docker.internal')
    except socket.gaierror:
        pass

    # 2. Docker bridge gateway (typically 172.17.0.1 on Linux)
    try:
        with open('/proc/net/route', 'r') as f:
            for line in f:
                fields = line.strip().split()
                if fields[1] == '00000000':  # Default route
                    gateway_hex = fields[2]
                    gateway_ip = socket.inet_ntoa(bytes.fromhex(gateway_hex)[::-1])
                    host_candidates.append(gateway_ip)
                    break
    except (FileNotFoundError, IndexError, ValueError):
        pass

    # 3. Fallback to common Docker bridge IP
    if not host_candidates:
        host_candidates.append('172.17.0.1')

    return host_candidates[0]


def _fix_ollama_urls(config_section: dict) -> dict:
    """
    Fix Ollama URLs for Docker environment.
    Replaces localhost URLs with appropriate Docker host URLs.
    """
    if not config_section or "config" not in config_section:
        return config_section

    ollama_config = config_section["config"]

    # Set default ollama_base_url if not provided
    if "ollama_base_url" not in ollama_config:
        ollama_config["ollama_base_url"] = "http://host.docker.internal:11434"
    else:
        url = ollama_config["ollama_base_url"]
        if "localhost" in url or "127.0.0.1" in url:
            docker_host = _get_docker_host_url()
            if docker_host != "localhost":
                new_url = url.replace("localhost", docker_host).replace("127.0.0.1", docker_host)
                ollama_config["ollama_base_url"] = new_url

    return config_section


def get_default_memory_config() -> dict:
    """Get default memory client configuration."""
    # Vector store configuration
    collection_name = os.environ.get('QDRANT_COLLECTION', 'memories')
    vector_store_config = {
        "collection_name": collection_name,
        "host": os.environ.get('QDRANT_HOST', '127.0.0.1'),
        "port": int(os.environ.get('QDRANT_PORT', 6333)),
    }
    vector_store_provider = "qdrant"

    # LLM configuration
    llm_provider = os.environ.get('LLM_PROVIDER', 'openai').lower()
    llm_model = os.environ.get('LLM_MODEL', 'gpt-4o-mini')
    llm_api_key = os.environ.get('LLM_API_KEY', 'env:OPENAI_API_KEY')
    llm_base_url = os.environ.get('LLM_BASE_URL')
    ollama_base_url = os.environ.get('OLLAMA_BASE_URL')

    llm_config: dict[str, Any] = {
        "temperature": 0.1,
        "max_tokens": 2000,
    }

    if llm_provider == "ollama":
        llm_config["model"] = llm_model or "llama3.1:latest"
        llm_config["ollama_base_url"] = ollama_base_url or llm_base_url or "http://localhost:11434"
    elif llm_provider == "openai":
        llm_config["model"] = llm_model or "gpt-4o-mini"
        llm_config["api_key"] = llm_api_key
        if llm_base_url:
            llm_config["openai_base_url"] = llm_base_url
    else:
        llm_config["model"] = llm_model
        if llm_api_key:
            llm_config["api_key"] = llm_api_key

    # Embedder configuration
    embedder_provider = os.environ.get('EMBEDDER_PROVIDER', 'openai').lower()
    embedder_model = os.environ.get('EMBEDDER_MODEL', 'text-embedding-3-small')
    embedder_api_key = os.environ.get('EMBEDDER_API_KEY', 'env:OPENAI_API_KEY')
    embedder_base_url = os.environ.get('EMBEDDER_BASE_URL')

    embedder_config: dict[str, Any] = {}
    if embedder_provider == "ollama":
        embedder_config["model"] = embedder_model or "nomic-embed-text"
        embedder_config["ollama_base_url"] = embedder_base_url or ollama_base_url or llm_base_url or "http://localhost:11434"
    elif embedder_provider == "openai":
        embedder_config["model"] = embedder_model or "text-embedding-3-small"
        embedder_config["api_key"] = embedder_api_key
        if embedder_base_url:
            embedder_config["openai_base_url"] = embedder_base_url
    else:
        embedder_config["model"] = embedder_model
        if embedder_api_key:
            embedder_config["api_key"] = embedder_api_key

    # Graph store configuration (Neo4j)
    graph_store_config = None
    if os.environ.get('NEO4J_URI'):
        graph_store_config = {
            "provider": "neo4j",
            "config": {
                "url": os.environ.get('NEO4J_URI', 'bolt://localhost:7687'),
                "username": os.environ.get('NEO4J_USERNAME', 'neo4j'),
                "password": os.environ.get('NEO4J_PASSWORD', 'mem0password'),
            }
        }

    config = {
        "vector_store": {
            "provider": vector_store_provider,
            "config": vector_store_config
        },
        "llm": {
            "provider": llm_provider,
            "config": llm_config
        },
        "embedder": {
            "provider": embedder_provider,
            "config": embedder_config
        },
        "version": "v1.1"
    }

    if graph_store_config:
        config["graph_store"] = graph_store_config

    return config


def _parse_environment_variables(config_dict: dict) -> dict:
    """
    Parse environment variables in config values.
    Converts 'env:VARIABLE_NAME' to actual environment variable values.
    """
    if isinstance(config_dict, dict):
        parsed_config = {}
        for key, value in config_dict.items():
            if isinstance(value, str) and value.startswith("env:"):
                env_var = value.split(":", 1)[1]
                env_value = os.environ.get(env_var)
                if env_value:
                    parsed_config[key] = env_value
                else:
                    parsed_config[key] = value
            elif isinstance(value, dict):
                parsed_config[key] = _parse_environment_variables(value)
            else:
                parsed_config[key] = value
        return parsed_config
    return config_dict


def get_memory_client() -> Optional[Any]:
    """
    Get or initialize the Mem0 client.

    Returns:
        Initialized Mem0 client instance or None if initialization fails.
    """
    global _memory_client, _config_hash

    try:
        config = get_default_memory_config()

        # Fix Ollama URLs for Docker environment
        if config.get("llm", {}).get("provider") == "ollama":
            config["llm"] = _fix_ollama_urls(config["llm"])
        if config.get("embedder", {}).get("provider") == "ollama":
            config["embedder"] = _fix_ollama_urls(config["embedder"])

        # Parse environment variables
        config = _parse_environment_variables(config)

        # Check if config has changed
        current_config_hash = _get_config_hash(config)

        if _memory_client is None or _config_hash != current_config_hash:
            from app.memory.memory.main import Memory
            _memory_client = Memory.from_config(config_dict=config)
            _config_hash = current_config_hash

        return _memory_client

    except Exception as e:
        import logging
        import traceback
        logging.error(f"Failed to initialize memory client: {e}")
        logging.error(f"Traceback: {traceback.format_exc()}")
        return None


def reset_memory_client() -> None:
    """Reset the global memory client to force reinitialization."""
    global _memory_client, _config_hash
    _memory_client = None
    _config_hash = None