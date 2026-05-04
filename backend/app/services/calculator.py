WEIGHT_FACTORS = {
    'Granite': {'2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5},
    'Quartz': {'2CM': 4.75, '3CM': 6.75, 'Mixed': 5.75},
    'Marble': {'2CM': 6.0, '3CM': 8.0, 'Mixed': 7.0},
    'Other': {'2CM': 5.5, '3CM': 7.5, 'Mixed': 6.5},
}

def calculate_sqft(length: float, width: float) -> float:
    return (length * width) / 144

def calculate_weight(length: float, width: float, material: str, thickness: str) -> float:
    sqft = calculate_sqft(length, width)
    factor = WEIGHT_FACTORS.get(material, WEIGHT_FACTORS['Other']).get(thickness, 6.5)
    return sqft * factor

def get_weight_factor(material: str, thickness: str) -> float:
    return WEIGHT_FACTORS.get(material, WEIGHT_FACTORS['Other']).get(thickness, 6.5)
