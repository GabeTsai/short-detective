from dataclasses import dataclass
import os
import base64


@dataclass
class LlmRequest:
    organization: str # one of "openai", "anthropic", "google"
    model: str
    system_prompt: str
    instructions: str
    images: list[str]


def _encode_image(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def _call_openai(info: LlmRequest) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    content = [{"type": "text", "text": info.instructions}]
    for image_path in info.images:
        base64_image = _encode_image(image_path)
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
        })

    response = client.chat.completions.create(
        model=info.model,
        messages=[
            {"role": "system", "content": info.system_prompt},
            {"role": "user", "content": content}
        ]
    )
    return response.choices[0].message.content


def _call_google(info: LlmRequest) -> str:
    import google.generativeai as genai
    from PIL import Image
    genai.configure(api_key=os.environ["GOOGLE_API_KEY"])

    model = genai.GenerativeModel(
        model_name=info.model,
        system_instruction=info.system_prompt
    )

    content = [info.instructions]
    for image_path in info.images:
        content.append(Image.open(image_path))

    response = model.generate_content(content)
    return response.text


def _call_anthropic(info: LlmRequest) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    content = []
    for image_path in info.images:
        base64_image = _encode_image(image_path)
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": base64_image
            }
        })
    content.append({"type": "text", "text": info.instructions})

    response = client.messages.create(
        model=info.model,
        max_tokens=4096,
        system=info.system_prompt,
        messages=[{"role": "user", "content": content}]
    )
    return response.content[0].text


def call_llm(info: LlmRequest) -> str:
    organization = info.organization
    if organization == "openai":
        return _call_openai(info)
    elif organization == "google":
        return _call_google(info)
    elif organization == "anthropic":
        return _call_anthropic(info)
    else:
        raise ValueError(f"Invalid organization: {organization}")