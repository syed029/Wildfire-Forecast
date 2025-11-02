# check_gc.py
from google.cloud import firestore
from google.oauth2 import service_account

SA_PATH = "keys/optimum-agent-305714-firebase-adminsdk-fbsvc-4dcb9bfb9d.json"

creds = service_account.Credentials.from_service_account_file(SA_PATH)
db = firestore.Client(project="optimum-agent-305714", credentials=creds)

ref = db.collection("__health__").document("direct-client")
ref.set({"ok": True})
print("GC client write OK, data:", ref.get().to_dict())
