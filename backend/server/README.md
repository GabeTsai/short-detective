Test code with: 


```
python3 server.py
```

In other tab: 

```
curl -X POST http://localhost:8000/send_urls \
  -H "Content-Type: application/json" \
  -d '["https://www.youtube.com/shorts/AVeuGFSSAxQ", "https://www.youtube.com/shorts/35KWWdck7zM"]'

```