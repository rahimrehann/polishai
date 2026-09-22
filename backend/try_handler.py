import json
from src.handler import lambda_handler

good = {"body": json.dumps({"text": "hey can u send me the file when ur free, thx"})}
empty = {"body": json.dumps({"text": "   "})}
missing = {"body": json.dumps({"hello": "world"})}
broken = {"body": "this is not json"}

print("GOOD:", lambda_handler(good, None))
print("EMPTY:", lambda_handler(empty, None))
print("MISSING:", lambda_handler(missing, None))
print("BROKEN:", lambda_handler(broken, None))