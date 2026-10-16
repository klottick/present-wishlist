from rest_framework.exceptions import APIException


class DomainError(APIException):
    def __init__(self, code, message, status, fields=None):
        super().__init__(message)
        self.status_code = status
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields
