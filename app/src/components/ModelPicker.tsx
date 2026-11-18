import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button, ui } from "./UI";
import { colors } from "../theme";
import { filterModels, sameModel, type ModelChoice } from "./selections";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useModelFavourites, toggleModelFavourite, modelFavouriteKey } from "../modelFavourites";
import { favouritesFirst } from "./modelFavouriteCore";
export type LoadState = "loading" | "error" | "ready";
export function ModelPicker({
  options,
  selected,
  onSelect,
  query,
  onQuery,
  state,
  retry,
  defaultLabel,
  allowDefault = false,
  maxHeight = 180,
}: {
  options: ModelChoice[];
  selected: ModelChoice | null;
  onSelect: (value: ModelChoice | null) => void;
  query: string;
  onQuery: (value: string) => void;
  state: LoadState;
  retry: () => void;
  defaultLabel: string;
  allowDefault?: boolean;
  maxHeight?: number;
}) {
  const favourites = useModelFavourites();
  const filtered = favouritesFirst(filterModels(options, query), favourites);
  return (
    <View style={{ gap: 8 }}>
      <Text style={ui.label}>Model</Text>
      <Text style={ui.muted}>Star your favourites to keep them at the top.</Text>
      <Text style={ui.muted}>
        Selected:{" "}
        {selected
          ? `${selected.model} · ${selected.providerName}`
          : allowDefault
            ? defaultLabel
            : "Choose a configured model"}
      </Text>
      <TextInput
        accessibilityLabel="Search configured models"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Search configured models"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={onQuery}
        style={ui.input}
      />
      {allowDefault && (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === null }}
          onPress={() => onSelect(null)}
        >
          <Text style={{ color: colors.accent, paddingVertical: 6 }}>
            {selected === null ? "✓ " : ""}
            {defaultLabel}
          </Text>
        </Pressable>
      )}
      {state === "loading" ? (
        <Text style={ui.muted}>Loading configured models…</Text>
      ) : state === "error" ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.warning }}>Could not load configured models.</Text>
          <Button label="Retry models" secondary onPress={retry} />
        </View>
      ) : !options.length ? (
        <Text style={ui.muted}>
          No configured models available.{" "}
          {allowDefault ? "You can use the gateway default." : "Check the gateway configuration."}
        </Text>
      ) : !filtered.length ? (
        <Text style={ui.muted}>No configured models match your search.</Text>
      ) : (
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight }}>
          {filtered.map((option) => (
            <View
              key={modelFavouriteKey(option)}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              <Pressable
                key={JSON.stringify([option.provider, option.model])}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: sameModel(selected, option),
                  disabled: option.disabled,
                }}
                disabled={option.disabled}
                onPress={() => onSelect(option)}
                style={{
                  flex: 1,
                  minHeight: 56,
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text }}>
                  {sameModel(selected, option) ? "✓ " : ""}
                  {option.model}
                </Text>
                <Text style={ui.muted}>
                  {option.providerName} · {option.provider}
                  {option.reason ? ` · ${option.reason}` : ""}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${favourites.includes(modelFavouriteKey(option)) ? "Remove" : "Add"} ${option.model} ${favourites.includes(modelFavouriteKey(option)) ? "from" : "to"} favourites`}
                accessibilityState={{ selected: favourites.includes(modelFavouriteKey(option)) }}
                onPress={() => {
                  try {
                    toggleModelFavourite(option);
                  } catch {
                    Alert.alert("Could not save favourite", "Please try again.");
                  }
                }}
                style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons
                  name={favourites.includes(modelFavouriteKey(option)) ? "star" : "star-outline"}
                  size={22}
                  color={colors.accent}
                />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
