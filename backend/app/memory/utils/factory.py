import importlib
from typing import Dict, Optional, Union

from app.memory.configs.embeddings.base import BaseEmbedderConfig
from app.memory.configs.llms.anthropic import AnthropicConfig
from app.memory.configs.llms.azure import AzureOpenAIConfig
from app.memory.configs.llms.base import BaseLlmConfig
from app.memory.configs.llms.deepseek import DeepSeekConfig
from app.memory.configs.llms.minimax import MinimaxConfig
from app.memory.configs.llms.lmstudio import LMStudioConfig
from app.memory.configs.llms.ollama import OllamaConfig
from app.memory.configs.llms.openai import OpenAIConfig
from app.memory.configs.llms.vllm import VllmConfig
from app.memory.configs.rerankers.base import BaseRerankerConfig
from app.memory.configs.rerankers.cohere import CohereRerankerConfig
from app.memory.configs.rerankers.sentence_transformer import SentenceTransformerRerankerConfig
from app.memory.configs.rerankers.zero_entropy import ZeroEntropyRerankerConfig
from app.memory.configs.rerankers.llm import LLMRerankerConfig
from app.memory.configs.rerankers.huggingface import HuggingFaceRerankerConfig
from app.memory.embeddings.mock import MockEmbeddings


def load_class(class_type):
    module_path, class_name = class_type.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


class LlmFactory:
    """
    Factory for creating LLM instances with appropriate configurations.
    Supports both old-style BaseLlmConfig and new provider-specific configs.
    """

    # Provider mappings with their config classes
    provider_to_class = {
        "ollama": ("app.memory.llms.ollama.OllamaLLM", OllamaConfig),
        "openai": ("app.memory.llms.openai.OpenAILLM", OpenAIConfig),
        "groq": ("app.memory.llms.groq.GroqLLM", BaseLlmConfig),
        "together": ("app.memory.llms.together.TogetherLLM", BaseLlmConfig),
        "aws_bedrock": ("app.memory.llms.aws_bedrock.AWSBedrockLLM", BaseLlmConfig),
        "litellm": ("app.memory.llms.litellm.LiteLLM", BaseLlmConfig),
        "azure_openai": ("app.memory.llms.azure_openai.AzureOpenAILLM", AzureOpenAIConfig),
        "openai_structured": ("app.memory.llms.openai_structured.OpenAIStructuredLLM", OpenAIConfig),
        "anthropic": ("app.memory.llms.anthropic.AnthropicLLM", AnthropicConfig),
        "azure_openai_structured": ("app.memory.llms.azure_openai_structured.AzureOpenAIStructuredLLM", AzureOpenAIConfig),
        "gemini": ("app.memory.llms.gemini.GeminiLLM", BaseLlmConfig),
        "deepseek": ("app.memory.llms.deepseek.DeepSeekLLM", DeepSeekConfig),
        "minimax": ("app.memory.llms.minimax.MiniMaxLLM", MinimaxConfig),
        "xai": ("app.memory.llms.xai.XAILLM", BaseLlmConfig),
        "sarvam": ("app.memory.llms.sarvam.SarvamLLM", BaseLlmConfig),
        "lmstudio": ("app.memory.llms.lmstudio.LMStudioLLM", LMStudioConfig),
        "vllm": ("app.memory.llms.vllm.VllmLLM", VllmConfig),
        "langchain": ("app.memory.llms.langchain.LangchainLLM", BaseLlmConfig),
    }

    @classmethod
    def create(cls, provider_name: str, config: Optional[Union[BaseLlmConfig, Dict]] = None, **kwargs):
        """
        Create an LLM instance with the appropriate configuration.

        Args:
            provider_name (str): The provider name (e.g., 'openai', 'anthropic')
            config: Configuration object or dict. If None, will create default config
            **kwargs: Additional configuration parameters

        Returns:
            Configured LLM instance

        Raises:
            ValueError: If provider is not supported
        """
        if provider_name not in cls.provider_to_class:
            raise ValueError(f"Unsupported Llm provider: {provider_name}")

        class_type, config_class = cls.provider_to_class[provider_name]
        llm_class = load_class(class_type)

        # Handle configuration
        if config is None:
            # Create default config with kwargs
            config = config_class(**kwargs)
        elif isinstance(config, dict):
            # Merge dict config with kwargs
            config.update(kwargs)
            config = config_class(**config)
        elif isinstance(config, BaseLlmConfig):
            # Convert base config to provider-specific config if needed
            if config_class != BaseLlmConfig:
                # Convert to provider-specific config
                config_dict = {
                    "model": config.model,
                    "temperature": config.temperature,
                    "api_key": config.api_key,
                    "max_tokens": config.max_tokens,
                    "top_p": config.top_p,
                    "top_k": config.top_k,
                    "enable_vision": config.enable_vision,
                    "vision_details": config.vision_details,
                    "http_client_proxies": config.http_client,
                }
                config_dict.update(kwargs)
                config = config_class(**config_dict)
            else:
                # Use base config as-is
                pass
        else:
            # Assume it's already the correct config type
            pass

        return llm_class(config)

    @classmethod
    def register_provider(cls, name: str, class_path: str, config_class=None):
        """
        Register a new provider.

        Args:
            name (str): Provider name
            class_path (str): Full path to LLM class
            config_class: Configuration class for the provider (defaults to BaseLlmConfig)
        """
        if config_class is None:
            config_class = BaseLlmConfig
        cls.provider_to_class[name] = (class_path, config_class)

    @classmethod
    def get_supported_providers(cls) -> list:
        """
        Get list of supported providers.

        Returns:
            list: List of supported provider names
        """
        return list(cls.provider_to_class.keys())


class EmbedderFactory:
    provider_to_class = {
        "openai": "app.memory.embeddings.openai.OpenAIEmbedding",
        "ollama": "app.memory.embeddings.ollama.OllamaEmbedding",
        "huggingface": "app.memory.embeddings.huggingface.HuggingFaceEmbedding",
        "azure_openai": "app.memory.embeddings.azure_openai.AzureOpenAIEmbedding",
        "gemini": "app.memory.embeddings.gemini.GoogleGenAIEmbedding",
        "vertexai": "app.memory.embeddings.vertexai.VertexAIEmbedding",
        "together": "app.memory.embeddings.together.TogetherEmbedding",
        "lmstudio": "app.memory.embeddings.lmstudio.LMStudioEmbedding",
        "langchain": "app.memory.embeddings.langchain.LangchainEmbedding",
        "aws_bedrock": "app.memory.embeddings.aws_bedrock.AWSBedrockEmbedding",
        "fastembed": "app.memory.embeddings.fastembed.FastEmbedEmbedding",
    }

    @classmethod
    def create(cls, provider_name, config, vector_config: Optional[dict]):
        if provider_name == "upstash_vector" and vector_config and vector_config.enable_embeddings:
            return MockEmbeddings()
        class_type = cls.provider_to_class.get(provider_name)
        if class_type:
            embedder_instance = load_class(class_type)
            base_config = BaseEmbedderConfig(**config)
            return embedder_instance(base_config)
        else:
            raise ValueError(f"Unsupported Embedder provider: {provider_name}")


class VectorStoreFactory:
    provider_to_class = {
        "qdrant": "app.memory.vector_stores.qdrant.Qdrant",
        "chroma": "app.memory.vector_stores.chroma.ChromaDB",
        "pgvector": "app.memory.vector_stores.pgvector.PGVector",
        "milvus": "app.memory.vector_stores.milvus.MilvusDB",
        "upstash_vector": "app.memory.vector_stores.upstash_vector.UpstashVector",
        "azure_ai_search": "app.memory.vector_stores.azure_ai_search.AzureAISearch",
        "azure_mysql": "app.memory.vector_stores.azure_mysql.AzureMySQL",
        "pinecone": "app.memory.vector_stores.pinecone.PineconeDB",
        "mongodb": "app.memory.vector_stores.mongodb.MongoDB",
        "redis": "app.memory.vector_stores.redis.RedisDB",
        "valkey": "app.memory.vector_stores.valkey.ValkeyDB",
        "databricks": "app.memory.vector_stores.databricks.Databricks",
        "elasticsearch": "app.memory.vector_stores.elasticsearch.ElasticsearchDB",
        "vertex_ai_vector_search": "app.memory.vector_stores.vertex_ai_vector_search.GoogleMatchingEngine",
        "opensearch": "app.memory.vector_stores.opensearch.OpenSearchDB",
        "supabase": "app.memory.vector_stores.supabase.Supabase",
        "weaviate": "app.memory.vector_stores.weaviate.Weaviate",
        "faiss": "app.memory.vector_stores.faiss.FAISS",
        "langchain": "app.memory.vector_stores.langchain.Langchain",
        "s3_vectors": "app.memory.vector_stores.s3_vectors.S3Vectors",
        "baidu": "app.memory.vector_stores.baidu.BaiduDB",
        "cassandra": "app.memory.vector_stores.cassandra.CassandraDB",
        "neptune": "app.memory.vector_stores.neptune_analytics.NeptuneAnalyticsVector",
        "turbopuffer": "app.memory.vector_stores.turbopuffer.TurbopufferDB",
    }

    @classmethod
    def create(cls, provider_name, config):
        class_type = cls.provider_to_class.get(provider_name)
        if class_type:
            if not isinstance(config, dict):
                config = config.model_dump()
            vector_store_instance = load_class(class_type)
            return vector_store_instance(**config)
        else:
            raise ValueError(f"Unsupported VectorStore provider: {provider_name}")

    @classmethod
    def reset(cls, instance):
        instance.reset()
        return instance


class GraphStoreFactory:
    """
    Factory for creating MemoryGraph instances for different graph store providers.
    Usage: GraphStoreFactory.create(provider_name, config)
    """

    provider_to_class = {
        "memgraph": "app.memory.memory.memgraph_memory.MemoryGraph",
        "neptune": "app.memory.graphs.neptune.neptunegraph.MemoryGraph",
        "neptunedb": "app.memory.graphs.neptune.neptunedb.MemoryGraph",
        "kuzu": "app.memory.memory.kuzu_memory.MemoryGraph",
        "apache_age": "app.memory.memory.apache_age_memory.MemoryGraph",
        "default": "app.memory.memory.graph_memory.MemoryGraph",
    }

    @classmethod
    def create(cls, provider_name, config):
        class_type = cls.provider_to_class.get(provider_name, cls.provider_to_class["default"])
        try:
            GraphClass = load_class(class_type)
        except (ImportError, AttributeError) as e:
            raise ImportError(f"Could not import MemoryGraph for provider '{provider_name}': {e}")
        return GraphClass(config)


class RerankerFactory:
    """
    Factory for creating reranker instances with appropriate configurations.
    Supports provider-specific configs following the same pattern as other factories.
    """

    # Provider mappings with their config classes
    provider_to_class = {
        "cohere": ("mem0.reranker.cohere_reranker.CohereReranker", CohereRerankerConfig),
        "sentence_transformer": ("mem0.reranker.sentence_transformer_reranker.SentenceTransformerReranker", SentenceTransformerRerankerConfig),
        "zero_entropy": ("mem0.reranker.zero_entropy_reranker.ZeroEntropyReranker", ZeroEntropyRerankerConfig),
        "llm_reranker": ("mem0.reranker.llm_reranker.LLMReranker", LLMRerankerConfig),
        "huggingface": ("mem0.reranker.huggingface_reranker.HuggingFaceReranker", HuggingFaceRerankerConfig),
    }

    @classmethod
    def create(cls, provider_name: str, config: Optional[Union[BaseRerankerConfig, Dict]] = None, **kwargs):
        """
        Create a reranker instance based on the provider and configuration.

        Args:
            provider_name: The reranker provider (e.g., 'cohere', 'sentence_transformer')
            config: Configuration object or dictionary
            **kwargs: Additional configuration parameters

        Returns:
            Reranker instance configured for the specified provider

        Raises:
            ImportError: If the provider class cannot be imported
            ValueError: If the provider is not supported
        """
        if provider_name not in cls.provider_to_class:
            raise ValueError(f"Unsupported reranker provider: {provider_name}")

        class_path, config_class = cls.provider_to_class[provider_name]

        # Handle configuration
        if config is None:
            config = config_class(**kwargs)
        elif isinstance(config, dict):
            config = config_class(**config, **kwargs)
        elif not isinstance(config, BaseRerankerConfig):
            raise ValueError(f"Config must be a {config_class.__name__} instance or dict")

        # Import and create the reranker class
        try:
            reranker_class = load_class(class_path)
        except (ImportError, AttributeError) as e:
            raise ImportError(f"Could not import reranker for provider '{provider_name}': {e}")

        return reranker_class(config)
