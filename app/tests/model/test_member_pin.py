from app.services.member_pin_policy import generate_temporary_pin, is_weak_pin


def test_weak_pins_are_rejected() -> None:
    assert is_weak_pin("123456")
    assert is_weak_pin("000000")
    assert is_weak_pin("199001", "1990-01-15")
    assert not is_weak_pin("482913")


def test_temporary_pin_is_six_digits_and_not_weak() -> None:
    pin = generate_temporary_pin("1990-01-15")
    assert len(pin) == 6
    assert pin.isdigit()
    assert not is_weak_pin(pin, "1990-01-15")
